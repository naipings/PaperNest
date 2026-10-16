//! 论文精读：PDF 段落 + pdffigures2 图表 → 看图预读与选图计划 → 五阶段证据驱动报告
//! （What/Why/How/Experiment/Question）→ 多轮追问。
//! 阶段划分、证据包选段与报告校验移植自 evidence-grounded-paper-deep-read（MIT），
//! skill 文本见 `deepread_skill/`，插图流程见 `deepread_visuals.rs`。
use super::*;
use crate::deepread_visuals::{self as visuals, FigureItem, VisualContext};
use crate::explain::{remove_explain_turn, PaperExplainMessage};
use crate::research::ResearchLlmSettings;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, Semaphore};

const SKILL_PROMPT: &str = include_str!("deepread_skill/skill.md");
const MAX_INPUT_CHARS: usize = 120_000;
const STAGE_MAX_TOKENS: u32 = 8_000;
const STAGE_TIMEOUT_SECS: u64 = 300;
const ASK_MAX_TOKENS: u32 = 3_000;
const ASK_TIMEOUT_SECS: u64 = 180;
const ASK_HISTORY_MESSAGES: usize = 12;
const ASK_EVIDENCE_CHARS: usize = 40_000;
const ASK_SKILL_MAX_ROUNDS: usize = 8;
const MIN_PAPER_CHARS: usize = 500;
const CANCELLED: &str = "精读已停止";

pub(crate) struct ReportStage {
  pub key: &'static str,
  heading: &'static str,
  description: &'static str,
  keywords: &'static [&'static str],
  always_keywords: &'static [&'static str],
}

pub(crate) const REPORT_STAGES: [ReportStage; 5] = [
  ReportStage {
    key: "what",
    heading: "## 1. What：做了什么",
    description: "说明具体任务、输入输出、核心做法与贡献。建议 200–350 字，不提前展开方法和实验。",
    keywords: &["abstract", "contribution", "propose", "task"],
    always_keywords: &["abstract"],
  },
  ReportStage {
    key: "why",
    heading: "## 2. Why：为什么做",
    description: "已有方法→具体不足→作者观察或启发→设计目标；区分作者陈述与推断。建议 300–500 字。",
    keywords: &["introduction", "related work", "motivation", "challenge", "problem", "limitation"],
    always_keywords: &["abstract"],
  },
  ReportStage {
    key: "how",
    heading: "## 3. How：如何实现",
    description: "详细展开输入→表征构造→关键模块→训练/优化→推理输出，每个核心模块讲清输入输出、内部操作、设计理由和与前后步骤的关系，关键公式就地定义符号。技术路线图按照全局计划去重后尽量全部展示，先交代如何读图，再结合模块、箭头和流程讲解；总览图与局部机制图通常互补。区分训练和推理，不能仅概述模块名称或省略核心技术细节。建议 1200–2000 字，复杂方法按需要扩展。",
    keywords: &["method", "approach", "model", "algorithm", "training", "loss", "equation", "feature", "network", "inference"],
    always_keywords: &["abstract"],
  },
  ReportStage {
    key: "experiment",
    heading: "## 4. Experiment：如何证明有效",
    description: "按作者目标选择实验：待验证主张→设置/基线/指标→关键结果→结论及边界。不要罗列全部实验。建议 500–800 字。",
    keywords: &["experiment", "results", "dataset", "baseline", "evaluation", "metric", "ablation", "table", "performance", "efficiency"],
    always_keywords: &["abstract"],
  },
  ReportStage {
    key: "question",
    heading: "## 5. Question：评价与疑问",
    description: "给出独立评价，区分作者局限与自己的推断；讨论影响主张的 2–4 个问题并提出可验证的补充实验。建议 300–500 字。",
    keywords: &["discussion", "conclusion", "limitation", "future", "failure", "baseline", "cost", "assumption"],
    always_keywords: &["abstract", "conclusion"],
  },
];

const SECTION_PATTERNS: [&str; 16] = [
  "abstract", "introduction", "related work", "background", "method", "methodology", "approach", "experiment",
  "experiments", "results", "analysis", "discussion", "limitation", "limitations", "conclusion", "references",
];

/// 与阅读台批注同一坐标系：相对页面宽高的 0–1 矩形。
#[derive(Clone, Serialize, Deserialize)]
pub struct Rect {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

/// V1 任务的 `sections.json` 没有 `rects`，按空数组读取：可跳页，不高亮。
#[derive(Clone, Serialize, Deserialize)]
pub struct Paragraph {
  pub id: String,
  pub text: String,
  #[serde(default)]
  pub rects: Vec<Rect>,
}

#[derive(Serialize)]
pub struct ParagraphLocation {
  pub id: String,
  pub page: i64,
  pub rects: Vec<Rect>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SectionPage {
  pub page: i64,
  pub paragraphs: Vec<Paragraph>,
}

#[derive(Serialize, Deserialize)]
struct Sections {
  pages: Vec<SectionPage>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInput {
  page: i64,
  paragraphs: Vec<ParagraphInput>,
}

#[derive(Deserialize)]
pub struct ParagraphInput {
  text: String,
  rects: Vec<Rect>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDeepReadInput {
  paper_id: Option<String>,
  title: String,
  source_name: String,
  pdf_base64: Option<String>,
  pages: Vec<PageInput>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepRead {
  pub id: String,
  pub paper_id: Option<String>,
  pub source_kind: String,
  pub title: String,
  pub source_name: String,
  pub workspace_path: String,
  pub status: String,
  pub stage: Option<String>,
  pub error: Option<String>,
  pub validation: Vec<String>,
  pub model: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeepReadDetail {
  pub task: DeepRead,
  pub report: String,
  pub messages: Vec<PaperExplainMessage>,
  pub stages_done: Vec<String>,
  pub figures: Vec<FigureItem>,
  pub paragraphs: Vec<ParagraphLocation>,
}

struct RunControl {
  tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
  gate: Semaphore,
}

/// 精读任务串行执行：批量选多篇时逐篇生成，避免同时打满调研 LLM 的并发与限流。
fn control() -> &'static RunControl {
  static CONTROL: OnceLock<RunControl> = OnceLock::new();
  CONTROL.get_or_init(|| RunControl { tokens: Mutex::new(HashMap::new()), gate: Semaphore::new(1) })
}

async fn ensure_not_cancelled(id: &str) -> Result<()> {
  let cancelled = control().tokens.lock().await.get(id).is_some_and(|token| token.load(Ordering::SeqCst));
  if cancelled {
    return Err(CANCELLED.into());
  }
  Ok(())
}

fn workspace_dir(library_dir: &Path, id: &str) -> PathBuf {
  library_dir.join("deepread").join(id)
}

fn row_task(library_dir: &Path, r: sqlx::sqlite::SqliteRow) -> Result<DeepRead> {
  let id: String = r.get("id");
  Ok(DeepRead {
    workspace_path: workspace_dir(library_dir, &id).to_string_lossy().into_owned(),
    id,
    paper_id: r.get("paper_id"),
    source_kind: r.get("source_kind"),
    title: r.get("title"),
    source_name: r.get("source_name"),
    status: r.get("status"),
    stage: r.get("stage"),
    error: r.get("error"),
    validation: serde_json::from_str(&r.get::<String, _>("validation_json")).map_err(err)?,
    model: r.get("model"),
    created_at: r.get("created_at"),
    updated_at: r.get("updated_at"),
  })
}

async fn load_task(pool: &SqlitePool, library_dir: &Path, id: &str) -> Result<DeepRead> {
  let row = sqlx::query("SELECT * FROM deep_reads WHERE id=?")
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(err)?
    .ok_or_else(|| "精读任务不存在".to_string())?;
  row_task(library_dir, row)
}

async fn load_messages(pool: &SqlitePool, id: &str) -> Result<Vec<PaperExplainMessage>> {
  let raw: String = sqlx::query_scalar("SELECT messages_json FROM deep_reads WHERE id=?")
    .bind(id)
    .fetch_one(pool)
    .await
    .map_err(err)?;
  serde_json::from_str(&raw).map_err(err)
}

async fn save_messages(pool: &SqlitePool, id: &str, messages: &[PaperExplainMessage]) -> Result<()> {
  sqlx::query("UPDATE deep_reads SET messages_json=?, updated_at=? WHERE id=?")
    .bind(serde_json::to_string(messages).map_err(err)?)
    .bind(Utc::now().to_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

async fn set_status(pool: &SqlitePool, id: &str, status: &str, stage: Option<&str>, error: Option<&str>) -> Result<()> {
  sqlx::query("UPDATE deep_reads SET status=?, stage=?, error=?, updated_at=? WHERE id=?")
    .bind(status)
    .bind(stage)
    .bind(error)
    .bind(Utc::now().to_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

fn read_report(workspace: &Path) -> Result<String> {
  let path = workspace.join("report.md");
  if !path.exists() {
    return Ok(String::new());
  }
  fs::read_to_string(path).map_err(err)
}

fn read_sections(workspace: &Path) -> Result<Vec<SectionPage>> {
  let raw = fs::read_to_string(workspace.join("sections.json")).map_err(err)?;
  Ok(serde_json::from_str::<Sections>(&raw).map_err(err)?.pages)
}

fn stages_done(workspace: &Path) -> Result<Vec<String>> {
  let mut done = Vec::new();
  for (key, file) in [("figures", visuals::MANIFEST_FILE), ("visuals", visuals::ANALYSIS_FILE), ("visual_plan", visuals::PLAN_FILE)] {
    if workspace.join(file).exists() {
      done.push(key.to_string());
    }
  }
  for stage in &REPORT_STAGES {
    let path = workspace.join("stages").join(format!("{}.md", stage.key));
    if path.exists() && !fs::read_to_string(&path).map_err(err)?.trim().is_empty() {
      done.push(stage.key.to_string());
    }
  }
  Ok(done)
}

fn normalize(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// 全局段落 ID 与参考项目一致：`P0001` 起按阅读顺序编号，空段丢弃。
pub(crate) fn number_paragraphs(pages: Vec<PageInput>) -> Vec<SectionPage> {
  let mut next = 1usize;
  pages
    .into_iter()
    .map(|page| SectionPage {
      page: page.page,
      paragraphs: page
        .paragraphs
        .into_iter()
        .map(|paragraph| (normalize(&paragraph.text), paragraph.rects))
        .filter(|(text, _)| !text.is_empty())
        .map(|(text, rects)| {
          let paragraph = Paragraph { id: format!("P{next:04}"), text, rects };
          next += 1;
          paragraph
        })
        .collect(),
    })
    .collect()
}

struct Candidate<'a> {
  order: usize,
  page: i64,
  id: &'a str,
  text: &'a str,
}

impl Candidate<'_> {
  fn block(&self) -> String {
    format!("[Page {}, {}] {}", self.page, self.id, self.text)
  }
}

fn candidates(pages: &[SectionPage]) -> Vec<Candidate<'_>> {
  pages
    .iter()
    .flat_map(|page| page.paragraphs.iter().map(move |paragraph| (page.page, paragraph)))
    .enumerate()
    .map(|(order, (page, paragraph))| Candidate { order, page, id: &paragraph.id, text: &paragraph.text })
    .collect()
}

fn keyword_score(text: &str, keywords: &[&str]) -> usize {
  let lowered = text.to_lowercase();
  keywords.iter().filter(|keyword| lowered.contains(&keyword.to_lowercase())).count()
}

/// 参考项目的正文预算：`max_input_chars` 的 55% 减去每张图表 700 字符（最多 24k），夹在 24k–48k 字符之间。
pub(crate) fn estimate_char_budget(max_input_chars: usize, figure_count: usize) -> usize {
  let figure_penalty = (figure_count * 700).min(24_000);
  let budget = ((max_input_chars as f64 * 0.55) as usize).saturating_sub(figure_penalty);
  max_input_chars.min(24_000usize.max(48_000usize.min(budget)))
}

/// 按阶段关键词相关度分配预算，再按阅读顺序还原；相邻段常含无关键词的公式或定义，预算允许时补入。
pub(crate) fn build_stage_text_pack(
  pages: &[SectionPage],
  stage_keywords: &[&str],
  always_keywords: &[&str],
  budget_chars: usize,
) -> String {
  let all = candidates(pages);
  let full = all.iter().map(Candidate::block).collect::<Vec<_>>().join("\n\n");
  if full.chars().count() <= budget_chars {
    return full;
  }
  let mut selected: Vec<&Candidate> = all.iter().filter(|c| keyword_score(c.text, always_keywords) > 0).collect();
  let selected_orders: HashSet<usize> = selected.iter().map(|c| c.order).collect();
  let mut scored: Vec<(usize, &Candidate)> = all
    .iter()
    .filter(|c| !selected_orders.contains(&c.order))
    .map(|c| (keyword_score(c.text, stage_keywords), c))
    .filter(|(score, _)| *score > 0)
    .collect();
  scored.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.order.cmp(&b.1.order)));
  selected.extend(scored.into_iter().map(|(_, c)| c));

  let mut chosen: Vec<&Candidate> = Vec::new();
  let mut used = 0usize;
  for item in selected {
    let cost = item.block().chars().count() + if chosen.is_empty() { 0 } else { 2 };
    if used + cost > budget_chars {
      continue;
    }
    chosen.push(item);
    used += cost;
    if used >= budget_chars {
      break;
    }
  }
  let chosen_orders: HashSet<usize> = chosen.iter().map(|c| c.order).collect();
  let neighbors: HashSet<usize> = chosen_orders
    .iter()
    .flat_map(|order| [order.checked_sub(1), Some(order + 1)])
    .flatten()
    .collect();
  for item in &all {
    if chosen_orders.contains(&item.order) || !neighbors.contains(&item.order) {
      continue;
    }
    let cost = item.block().chars().count() + 2;
    if used + cost <= budget_chars {
      chosen.push(item);
      used += cost;
    }
  }
  chosen.sort_by_key(|c| c.order);
  chosen.iter().map(|c| c.block()).collect::<Vec<_>>().join("\n\n")
}

fn looks_like_heading(text: &str) -> bool {
  let compact = text.trim().trim_start_matches(|c: char| c.is_ascii_digit() || c == '.').trim_start().to_lowercase();
  if compact.chars().count() > 80 {
    return false;
  }
  SECTION_PATTERNS.iter().any(|pattern| compact.starts_with(pattern))
}

pub(crate) fn section_candidates(pages: &[SectionPage]) -> String {
  let lines: Vec<String> = pages
    .iter()
    .flat_map(|page| {
      page
        .paragraphs
        .iter()
        .filter(|p| looks_like_heading(&p.text))
        .map(move |p| format!("- {} (Page {}, {})", p.text, page.page, p.id))
    })
    .collect();
  if lines.is_empty() {
    "未识别到章节标题。".into()
  } else {
    lines.join("\n")
  }
}

pub(crate) fn stage_messages(
  stage: &ReportStage,
  title: &str,
  source_name: &str,
  pages: &[SectionPage],
  previous: &[(&str, String)],
  visual: &VisualContext,
) -> Result<(String, String)> {
  let evidence_pack = build_stage_text_pack(
    pages,
    stage.keywords,
    stage.always_keywords,
    estimate_char_budget(MAX_INPUT_CHARS, visual.manifest.len()),
  );
  let prior = previous.iter().map(|(_, text)| text.as_str()).collect::<Vec<_>>().join("\n\n");
  let system = "你是一名严谨的论文精读助手。只输出最终 Markdown，不输出思考过程。报告语言：简体中文。保留 What/Why/How/Experiment/Question 叙述路线。图表必须自然融入对应正文段落，不要单开图表精读章节。".to_string();
  let user = format!(
    "请为论文精读报告生成一个局部阶段。

论文标题：{title}
PDF 文件名：{source_name}
报告语言：简体中文
当前阶段：{description}

硬性要求：
- 只输出本阶段要求的 Markdown 章节，不要输出完整报告标题。
- 使用标题 `{heading}`。
- 只输出一个二级章节；可少量使用三级标题，不重复前文。
- 行内公式使用 $...$，行间公式使用独占行的 $$ 包裹，禁止其他数学定界符。
- 执行全局选图计划，本阶段所有 include=true 图表必须在指定章节展示并讲解，不能因压缩篇幅再次删除；include=false 图表不插入。
- How 按去重后的技术路线图组织讲解：总流程→局部机制→训练与推理，图前指明阅读重点，图后解释关键部件和设计理由。互补图不当成冗余。
- Experiment 按计划中核心贡献的证明链自主组织图表和文字，明确比较条件、结果与边界；不凑图数，不重复同一图表。
- 抽取遗漏或图像不可读时明确证据限制；不能自行截图或裁剪，不能编造数值。
- 独立评价需标注“我的判断”或 `(Inference from ...)`，不可冒充作者结论。
- 重要判断必须带 evidence marker，例如 `(Evidence: Page 3, P0042)` 或 `(Evidence: Page 3, Fig. 2)`。
- 如果使用图片，必须引用 Figure And Table Manifest 中的 `image` 路径，例如 `![Figure 2](figures/paper-Figure2-1.png)`。
- 不要编造没有证据的作者、年份、实验结果或公式。

{SKILL_PROMPT}

# Previous Generated Sections
```markdown
{prior}
```

# Section Candidates
{candidates}

# All Visual Analyses (completed before writing)
{analysis}

# Global Visual Plan
{plan}

# Figure And Table Manifest
```json
{manifest}
```

# Stage Evidence Pack
```markdown
{evidence_pack}
```",
    description = stage.description,
    heading = stage.heading,
    candidates = section_candidates(pages),
    analysis = serde_json::to_string_pretty(&visual.analysis).map_err(err)?,
    plan = serde_json::to_string_pretty(&visual.plan).map_err(err)?,
    manifest = serde_json::to_string_pretty(&visual.manifest).map_err(err)?,
  );
  Ok((system, user))
}

pub(crate) fn strip_markdown_fence(text: &str) -> String {
  let trimmed = text.trim();
  if trimmed.len() >= 6 && trimmed.starts_with("```") && trimmed.ends_with("```") {
    let inner = &trimmed[3..trimmed.len() - 3];
    return inner.strip_prefix("markdown").unwrap_or(inner).trim().to_string();
  }
  trimmed.to_string()
}

pub(crate) fn assemble_report(title: &str, sections: &[(&str, String)]) -> Result<String> {
  let mut parts = vec![format!("# 论文精读报告：{title}")];
  for (key, raw) in sections {
    let content = strip_markdown_fence(raw);
    if content.is_empty() {
      return Err(format!("阶段 {key} 没有返回内容"));
    }
    let body = if content.starts_with("# ") {
      content.split_once('\n').map(|(_, rest)| rest.trim_start().to_string()).unwrap_or_default()
    } else {
      content
    };
    parts.push(body);
  }
  Ok(format!("{}\n", parts.join("\n\n").trim()))
}

/// 去掉 ``` 围栏代码块，返回剩余正文与各代码块内容。
fn split_fenced(text: &str) -> (String, Vec<String>) {
  let mut prose = String::new();
  let mut blocks = Vec::new();
  let mut rest = text;
  while let Some(start) = rest.find("```") {
    prose.push_str(&rest[..start]);
    let after = &rest[start + 3..];
    match after.find("```") {
      Some(end) => {
        blocks.push(after[..end].to_string());
        rest = &after[end + 3..];
      }
      None => {
        prose.push_str(&rest[start..]);
        rest = "";
      }
    }
  }
  prose.push_str(rest);
  (prose, blocks)
}

fn unescaped_dollars(text: &str) -> usize {
  let chars: Vec<char> = text.chars().collect();
  (0..chars.len()).filter(|&i| chars[i] == '$' && (i == 0 || chars[i - 1] != '\\')).count()
}

fn has_unescaped_double_dollar(text: &str) -> bool {
  let chars: Vec<char> = text.chars().collect();
  (0..chars.len().saturating_sub(1)).any(|i| chars[i] == '$' && chars[i + 1] == '$' && (i == 0 || chars[i - 1] != '\\'))
}

fn inline_code_spans(line: &str) -> Vec<&str> {
  let parts: Vec<&str> = line.split('`').collect();
  parts.iter().skip(1).step_by(2).take(parts.len() / 2).copied().collect()
}

fn math_problems(text: &str) -> Vec<String> {
  let mut problems = Vec::new();
  let chars: Vec<char> = text.chars().collect();
  if (0..chars.len().saturating_sub(1)).any(|i| chars[i] == '\\' && matches!(chars[i + 1], '[' | ']' | '(' | ')')) {
    problems.push("公式应使用 $...$ 或 $$，不要用 \\( \\) 或 \\[ \\]".into());
  }
  let (prose, blocks) = split_fenced(text);
  if blocks.iter().any(|block| unescaped_dollars(block) > 0) {
    problems.push("公式不能放在代码块里".into());
  }
  if prose.lines().flat_map(inline_code_spans).any(|span| unescaped_dollars(span) > 0) {
    problems.push("公式不能包在行内代码里".into());
  }
  let mut in_display = false;
  let mut inline_open = false;
  for line in prose.lines() {
    let line: String = line.split('`').step_by(2).collect();
    if line.trim() == "$$" {
      if inline_open {
        problems.push("行内公式跨越了行间公式边界".into());
        inline_open = false;
      }
      in_display = !in_display;
      continue;
    }
    if has_unescaped_double_dollar(&line) {
      problems.push("行间公式的 $$ 必须各自独占一行".into());
    }
    if !in_display {
      inline_open = (usize::from(inline_open) + unescaped_dollars(&line)) % 2 == 1;
      if line.trim().is_empty() && inline_open {
        problems.push("段落结束前行内公式未闭合".into());
        inline_open = false;
      }
    }
  }
  if in_display {
    problems.push("行间公式未闭合".into());
  }
  if inline_open {
    problems.push("行内公式未闭合".into());
  }
  problems
}

fn heading_matches(heading: &str, index: usize, concept: &str) -> bool {
  let Some(rest) = heading.strip_prefix(&format!("{}.", index + 1)) else { return false };
  if !rest.starts_with(char::is_whitespace) {
    return false;
  }
  let rest = rest.trim_start().to_lowercase();
  rest.starts_with(concept) && !rest[concept.len()..].starts_with(|c: char| c.is_alphanumeric() || c == '_')
}

fn has_evidence(body: &str) -> bool {
  let lowered = body.to_lowercase();
  lowered.contains("evidence:")
    || lowered.contains("inference from")
    || ["证据：", "证据:", "推断依据：", "推断依据:"].iter().any(|marker| body.contains(marker))
}

/// 参考项目 validate_report：五节顺序、每节证据锚点、标题、占位符、数学定界符、插图来源与选图计划覆盖。
pub(crate) fn validate_report(text: &str, visual: &VisualContext) -> Vec<String> {
  const CONCEPTS: [&str; 5] = ["what", "why", "how", "experiment", "question"];
  let mut problems = Vec::new();
  let (prose, _) = split_fenced(text);
  let lines: Vec<&str> = prose.lines().collect();
  let headings: Vec<(usize, &str)> = lines
    .iter()
    .enumerate()
    .filter_map(|(i, line)| {
      let rest = line.strip_prefix("##")?;
      rest.starts_with(char::is_whitespace).then(|| (i, rest.trim()))
    })
    .collect();
  if headings.len() != 5 {
    problems.push(format!("应恰好有五个二级章节（What、Why、How、Experiment、Question），实际 {} 个", headings.len()));
  }
  for (index, concept) in CONCEPTS.iter().enumerate() {
    let Some(&(line_index, heading)) = headings.get(index) else { break };
    if !heading_matches(heading, index, concept) {
      problems.push(format!("第 {} 节应为 {}", index + 1, concept));
    }
    let end = headings.get(index + 1).map(|(i, _)| *i).unwrap_or(lines.len());
    let body = lines[line_index + 1..end].join("\n");
    if body.trim().is_empty() {
      problems.push(format!("{concept} 节为空"));
    } else if !has_evidence(&body) {
      problems.push(format!("{concept} 节缺少证据或推断标记"));
    }
  }
  if !lines.iter().any(|line| line.starts_with("# ") && line.len() > 2) {
    problems.push("缺少报告标题".into());
  }
  if text.split(|c: char| !c.is_ascii_alphanumeric()).any(|word| word == "TODO") || text.contains("生成失败") {
    problems.push("报告含未完成占位符".into());
  }
  problems.extend(math_problems(text));
  problems.extend(visuals::coverage_problems(text, &visual.plan));
  problems.extend(visuals::image_problems(text, visual));
  let mut seen = HashSet::new();
  problems.retain(|problem| seen.insert(problem.clone()));
  problems
}

fn question_keywords(question: &str) -> Vec<String> {
  let mut out: Vec<String> = Vec::new();
  for word in question.split(|c: char| !c.is_ascii_alphanumeric()) {
    let word = word.to_lowercase();
    if word.len() >= 3 && !out.contains(&word) {
      out.push(word);
    }
  }
  out.extend(["method", "experiment", "result", "conclusion"].map(String::from));
  out
}

pub(crate) async fn reset_interrupted(pool: &SqlitePool) -> Result<()> {
  sqlx::query("UPDATE deep_reads SET status='failed', stage=NULL, error=?, updated_at=? WHERE status IN ('queued','running')")
    .bind("上次运行随应用退出中断，可点击「继续生成」")
    .bind(Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

pub(crate) struct RunPaths {
  pub workspace: PathBuf,
  pub source_pdf: PathBuf,
  pub pdffigures2_dir: PathBuf,
}

/// 图表提取 → 逐图预读 → 全局选图计划；每步产物落盘后断点续跑时跳过。
async fn prepare_visuals(pool: &SqlitePool, paths: &RunPaths, settings: &ResearchLlmSettings, task: &DeepRead, pages: &[SectionPage]) -> Result<VisualContext> {
  let workspace = paths.workspace.as_path();
  let manifest = if workspace.join(visuals::MANIFEST_FILE).exists() {
    visuals::load_manifest(workspace)?
  } else {
    ensure_not_cancelled(&task.id).await?;
    set_status(pool, &task.id, "running", Some("figures"), None).await?;
    visuals::extract_figures(&paths.pdffigures2_dir, &paths.source_pdf, workspace).await?
  };
  if !workspace.join(visuals::ANALYSIS_FILE).exists() {
    let mut records = Vec::new();
    for (index, item) in manifest.iter().enumerate() {
      ensure_not_cancelled(&task.id).await?;
      set_status(pool, &task.id, "running", Some(&format!("visuals:{}/{}", index + 1, manifest.len())), None).await?;
      records.push(visuals::analyze_visual(settings, workspace, index, item, pages).await?);
    }
    visuals::finish_analysis(workspace, records, pages)?;
  }
  if !workspace.join(visuals::PLAN_FILE).exists() {
    if manifest.is_empty() {
      visuals::write_empty_plan(workspace)?;
    } else {
      ensure_not_cancelled(&task.id).await?;
      set_status(pool, &task.id, "running", Some("visual_plan"), None).await?;
      let analysis = visuals::read_json(&workspace.join(visuals::ANALYSIS_FILE))?;
      visuals::build_plan(settings, workspace, &analysis, pages).await?;
    }
  }
  visuals::load_context(workspace)
}

async fn generate(pool: &SqlitePool, paths: &RunPaths, settings: &ResearchLlmSettings, task: &DeepRead) -> Result<Vec<String>> {
  let _permit = control().gate.acquire().await.map_err(err)?;
  ensure_not_cancelled(&task.id).await?;
  set_status(pool, &task.id, "running", None, None).await?;
  let workspace = paths.workspace.as_path();
  let pages = read_sections(workspace)?;
  let visual = prepare_visuals(pool, paths, settings, task, &pages).await?;
  let stages_dir = workspace.join("stages");
  fs::create_dir_all(&stages_dir).map_err(err)?;
  let mut generated: Vec<(&str, String)> = Vec::new();
  for stage in &REPORT_STAGES {
    let path = stages_dir.join(format!("{}.md", stage.key));
    if path.exists() {
      let cached = fs::read_to_string(&path).map_err(err)?;
      if !cached.trim().is_empty() {
        generated.push((stage.key, cached));
        continue;
      }
    }
    ensure_not_cancelled(&task.id).await?;
    set_status(pool, &task.id, "running", Some(stage.key), None).await?;
    let (system, user) = stage_messages(stage, &task.title, &task.source_name, &pages, &generated, &visual)?;
    let (text, finish_reason) = crate::research_llm::research_llm_completion_streamed(
      settings,
      &system,
      serde_json::Value::String(user),
      STAGE_MAX_TOKENS,
      STAGE_TIMEOUT_SECS,
    )
    .await?;
    if finish_reason.as_deref() == Some("length") {
      return Err(format!(
        "{} 阶段输出达到上限（{STAGE_MAX_TOKENS} tokens）被截断，可换用输出上限更高的模型后点击「继续生成」",
        stage.key
      ));
    }
    fs::write(&path, &text).map_err(err)?;
    generated.push((stage.key, text));
  }
  let report = assemble_report(&task.title, &generated)?;
  fs::write(workspace.join("report.md"), &report).map_err(err)?;
  Ok(validate_report(&report, &visual))
}

async fn run_task(pool: SqlitePool, paths: RunPaths, settings: ResearchLlmSettings, task: DeepRead) {
  let outcome = generate(&pool, &paths, &settings, &task).await;
  control().tokens.lock().await.remove(&task.id);
  let now = Utc::now().to_rfc3339();
  let query = match &outcome {
    Ok(validation) => sqlx::query("UPDATE deep_reads SET status='completed', stage=NULL, error=NULL, validation_json=?, model=?, updated_at=? WHERE id=?")
      .bind(serde_json::json!(validation).to_string())
      .bind(&settings.model)
      .bind(&now)
      .bind(&task.id),
    Err(error) => sqlx::query("UPDATE deep_reads SET status=?, stage=NULL, error=?, updated_at=? WHERE id=?")
      .bind(if error == CANCELLED { "cancelled" } else { "failed" })
      .bind(error)
      .bind(&now)
      .bind(&task.id),
  };
  if let Err(error) = query.execute(&pool).await {
    eprintln!("deepread {}: 写入运行结果失败：{error}", task.id);
  }
}

#[tauri::command]
pub async fn deepread_list(state: State<'_, AppState>) -> Result<Vec<DeepRead>> {
  let pool = state.pool.read().await;
  sqlx::query("SELECT * FROM deep_reads ORDER BY updated_at DESC")
    .fetch_all(&*pool)
    .await
    .map_err(err)?
    .into_iter()
    .map(|row| row_task(&state.library_dir, row))
    .collect()
}

#[tauri::command]
pub async fn deepread_get(state: State<'_, AppState>, id: String) -> Result<DeepReadDetail> {
  let pool = state.pool.read().await;
  let task = load_task(&pool, &state.library_dir, &id).await?;
  let messages = load_messages(&pool, &id).await?;
  let workspace = PathBuf::from(&task.workspace_path);
  Ok(DeepReadDetail {
    report: read_report(&workspace)?,
    stages_done: stages_done(&workspace)?,
    figures: visuals::load_manifest(&workspace)?,
    paragraphs: read_sections(&workspace)?
      .into_iter()
      .flat_map(|page| {
        page.paragraphs.into_iter().map(move |paragraph| ParagraphLocation { id: paragraph.id, page: page.page, rects: paragraph.rects })
      })
      .collect(),
    task,
    messages,
  })
}

#[tauri::command]
pub async fn deepread_save_report(state: State<'_, AppState>, id: String, report: String) -> Result<()> {
  let pool = state.pool.read().await;
  let task = load_task(&pool, &state.library_dir, &id).await?;
  if task.status == "running" || task.status == "queued" {
    return Err("报告生成中，不能编辑".into());
  }
  fs::write(PathBuf::from(&task.workspace_path).join("report.md"), report).map_err(err)?;
  Ok(())
}

#[tauri::command]
pub async fn deepread_create(state: State<'_, AppState>, input: CreateDeepReadInput) -> Result<DeepRead> {
  let pages = number_paragraphs(input.pages);
  let chars: usize = pages.iter().flat_map(|page| &page.paragraphs).map(|p| p.text.chars().count()).sum();
  if chars < MIN_PAPER_CHARS {
    return Err(format!("《{}》没有足够的可抽取正文（扫描版请先在阅读台 OCR 或换用文字版 PDF）", input.source_name));
  }
  let pool = state.pool.read().await;
  let source_kind = match (&input.paper_id, &input.pdf_base64) {
    (Some(paper_id), _) => {
      let exists: Option<String> = sqlx::query_scalar("SELECT id FROM papers WHERE id=? AND deleted_at IS NULL")
        .bind(paper_id)
        .fetch_optional(&*pool)
        .await
        .map_err(err)?;
      if exists.is_none() {
        return Err("论文不存在或已删除".into());
      }
      "library"
    }
    (None, Some(_)) => "external",
    (None, None) => return Err("缺少论文来源".into()),
  };
  let id = Uuid::new_v4().to_string();
  let workspace = workspace_dir(&state.library_dir, &id);
  fs::create_dir_all(workspace.join("stages")).map_err(err)?;
  if let Some(data) = &input.pdf_base64 {
    fs::write(workspace.join("source.pdf"), BASE64.decode(data.trim()).map_err(err)?).map_err(err)?;
  }
  fs::write(workspace.join("sections.json"), serde_json::to_vec_pretty(&Sections { pages }).map_err(err)?).map_err(err)?;
  let now = Utc::now().to_rfc3339();
  sqlx::query(
    "INSERT INTO deep_reads(id,paper_id,source_kind,title,source_name,status,created_at,updated_at) VALUES(?,?,?,?,?,'draft',?,?)",
  )
  .bind(&id)
  .bind(&input.paper_id)
  .bind(source_kind)
  .bind(input.title.trim())
  .bind(&input.source_name)
  .bind(&now)
  .bind(&now)
  .execute(&*pool)
  .await
  .map_err(err)?;
  load_task(&pool, &state.library_dir, &id).await
}

/// `restart=true` 清空已生成阶段从头写；否则复用 `stages/` 里已完成的阶段继续。
#[tauri::command]
pub async fn deepread_run(app: tauri::AppHandle, state: State<'_, AppState>, id: String, restart: bool) -> Result<DeepRead> {
  let settings = crate::research::load_research_settings(&state.library_dir).await?;
  if !settings.enabled || !settings.api_key_saved {
    return Err("论文精读使用「设置 → 文献调研」的 LLM，请先启用并保存 API Key".into());
  }
  let pool = state.pool.read().await.clone();
  let task = load_task(&pool, &state.library_dir, &id).await?;
  let workspace = PathBuf::from(&task.workspace_path);
  let source_pdf = match &task.paper_id {
    Some(paper_id) => {
      let pdf_path: Option<String> = sqlx::query_scalar("SELECT pdf_path FROM papers WHERE id=?")
        .bind(paper_id)
        .fetch_optional(&pool)
        .await
        .map_err(err)?
        .flatten();
      state.library_dir.join(pdf_path.filter(|path| !path.is_empty()).ok_or_else(|| "论文没有 PDF".to_string())?)
    }
    None => workspace.join("source.pdf"),
  };
  let paths = RunPaths {
    pdffigures2_dir: dunce::simplified(&app.path().resource_dir().map_err(err)?).join("pdffigures2"),
    source_pdf,
    workspace,
  };
  {
    let mut tokens = control().tokens.lock().await;
    if tokens.contains_key(&id) {
      return Err("该精读仍在运行，请等待当前阶段结束".into());
    }
    tokens.insert(id.clone(), Arc::new(AtomicBool::new(false)));
  }
  let prepared = async {
    if restart {
      let workspace = &paths.workspace;
      let stage_files = REPORT_STAGES.iter().map(|stage| workspace.join("stages").join(format!("{}.md", stage.key)));
      let generated = [visuals::MANIFEST_FILE, visuals::ANALYSIS_FILE, visuals::PLAN_FILE, "report.md"].map(|file| workspace.join(file));
      for path in stage_files.chain(generated) {
        if path.exists() {
          fs::remove_file(path).map_err(err)?;
        }
      }
      for dir in [visuals::FIGURES_DIR, visuals::VISUALS_DIR].map(|dir| workspace.join(dir)) {
        if dir.exists() {
          fs::remove_dir_all(dir).map_err(err)?;
        }
      }
      sqlx::query("UPDATE deep_reads SET validation_json='[]' WHERE id=?").bind(&id).execute(&pool).await.map_err(err)?;
    }
    set_status(&pool, &id, "queued", None, None).await?;
    load_task(&pool, &state.library_dir, &id).await
  }
  .await;
  match prepared {
    Ok(queued) => {
      tauri::async_runtime::spawn(run_task(pool, paths, settings, queued.clone()));
      Ok(queued)
    }
    Err(error) => {
      control().tokens.lock().await.remove(&id);
      Err(error)
    }
  }
}

#[tauri::command]
pub async fn deepread_cancel(state: State<'_, AppState>, id: String) -> Result<DeepRead> {
  let token = control().tokens.lock().await.get(&id).cloned().ok_or_else(|| "该精读未在运行".to_string())?;
  token.store(true, Ordering::SeqCst);
  let pool = state.pool.read().await;
  sqlx::query("UPDATE deep_reads SET error=?, updated_at=? WHERE id=?")
    .bind("正在停止：当前阶段结束后生效")
    .bind(Utc::now().to_rfc3339())
    .bind(&id)
    .execute(&*pool)
    .await
    .map_err(err)?;
  load_task(&pool, &state.library_dir, &id).await
}

fn skill_tools() -> [crate::research_tools::ToolSpec; 2] {
  let skill = serde_json::json!({ "type": "string", "description": "skill 名称（可用 skill 清单中的名称）" });
  [
    crate::research_tools::ToolSpec {
      name: "load_skill",
      description: "读取一个 skill 的 SKILL.md 全文与文件清单",
      parameters: serde_json::json!({ "type": "object", "properties": { "skill": skill }, "required": ["skill"] }),
    },
    crate::research_tools::ToolSpec {
      name: "read_skill_file",
      description: "读取 skill 目录内的文本文件。path 相对该 skill 目录，可用 ../<目录>/ 读取 SKILL.md 引用的同级共享目录",
      parameters: serde_json::json!({
        "type": "object",
        "properties": { "skill": skill, "path": { "type": "string", "description": "文件路径，如 references/guide.md" } },
        "required": ["skill", "path"]
      }),
    },
  ]
}

/// 追问的工具循环：模型按 skill 描述决定是否读取 skill；返回回答与本轮读取过的 skill。
async fn ask_with_skills(
  settings: &ResearchLlmSettings,
  library_dir: &Path,
  system: &str,
  user: String,
  skills: &[(String, String)],
) -> Result<(String, Vec<String>)> {
  let catalog: String = skills.iter().map(|(dir, description)| format!("- {dir}：{description}\n")).collect();
  let system = format!(
    "{system}\n\n# 可用 skill\n以下 skill 提供特定任务的方法说明。问题与某个 skill 的描述相符时，先调用 load_skill 读取说明，再按需用 read_skill_file 读取说明中引用的文件，然后按其方法回答；与问题无关时不调用。skill 中的脚本无法执行，只参考其文字。skill 规定的输出格式与上述证据格式冲突时，保留证据标记。\n{catalog}"
  );
  let tools = skill_tools();
  let mut messages = vec![
    serde_json::json!({ "role": "system", "content": system }),
    serde_json::json!({ "role": "user", "content": user }),
  ];
  let mut used: Vec<String> = Vec::new();
  for _ in 0..ASK_SKILL_MAX_ROUNDS {
    let response = crate::research_llm::research_llm_with_tools(settings, &messages, &tools, Some(ASK_MAX_TOKENS), ASK_TIMEOUT_SECS).await?;
    if response.tool_calls.is_empty() {
      let answer = response.content.filter(|c| !c.trim().is_empty()).ok_or("模型未返回回答")?;
      return Ok((answer, used));
    }
    messages.push(crate::research_subagent::subagent_assistant_message(&response.tool_calls, response.content.as_deref()));
    for call in response.tool_calls {
      let skill = call.arguments.get("skill").and_then(|v| v.as_str()).unwrap_or_default();
      let observation = if !skills.iter().any(|(dir, _)| dir == skill) {
        Err(format!("没有名为 {skill} 的已启用 skill"))
      } else {
        match call.name.as_str() {
          "load_skill" => crate::skills::load_skill_text(library_dir, skill),
          "read_skill_file" => {
            let path = call.arguments.get("path").and_then(|v| v.as_str()).unwrap_or_default();
            crate::skills::read_skill_file(library_dir, skill, path)
          }
          other => Err(format!("未知工具 {other}")),
        }
      };
      if observation.is_ok() && !used.iter().any(|s| s == skill) {
        used.push(skill.to_string());
      }
      let content = observation.unwrap_or_else(|e| format!("错误：{e}"));
      messages.push(serde_json::json!({ "role": "tool", "tool_call_id": call.id, "content": content }));
    }
  }
  Err(format!("追问读取 skill 超过 {ASK_SKILL_MAX_ROUNDS} 轮仍未给出回答"))
}

#[tauri::command]
pub async fn deepread_ask(state: State<'_, AppState>, id: String, question: String) -> Result<DeepReadDetail> {
  let question = question.trim().to_string();
  if question.is_empty() {
    return Err("请输入问题".into());
  }
  let settings = crate::research::load_research_settings(&state.library_dir).await?;
  if !settings.enabled || !settings.api_key_saved {
    return Err("论文精读使用「设置 → 文献调研」的 LLM，请先启用并保存 API Key".into());
  }
  let (task, mut messages, skills) = {
    let pool = state.pool.read().await;
    (
      load_task(&pool, &state.library_dir, &id).await?,
      load_messages(&pool, &id).await?,
      crate::skills::enabled_skills(&pool).await?,
    )
  };
  let workspace = PathBuf::from(&task.workspace_path);
  let report = read_report(&workspace)?;
  if report.trim().is_empty() {
    return Err("报告生成完成后才能追问".into());
  }
  let pages = read_sections(&workspace)?;
  let keywords = question_keywords(&question);
  let keyword_refs: Vec<&str> = keywords.iter().map(String::as_str).collect();
  let evidence = build_stage_text_pack(&pages, &keyword_refs, &["abstract"], ASK_EVIDENCE_CHARS);
  let mut transcript = String::new();
  for message in messages.iter().skip(messages.len().saturating_sub(ASK_HISTORY_MESSAGES)) {
    let label = if message.role == "user" { "用户" } else { "助手" };
    transcript.push_str(&format!("{label}：{}\n\n", message.content.trim()));
  }
  let system = "你是论文精读追问助手。依据下方精读报告与论文原文段落回答用户问题，使用简体中文。重要事实给出证据标记，格式沿用 (Evidence: p. 5, P0042)；你自己的推断标注“我的判断”。原文段落没有依据时直接说明证据不足，不编造数值、公式或实验。行内公式用 $...$，行间公式用独占行的 $$。";
  let user = format!(
    "论文：{}\n\n# 精读报告\n{}\n\n# 原文段落\n{}\n\n# 对话\n{}用户：{}\n助手：",
    task.title,
    report.trim(),
    evidence,
    transcript,
    question
  );
  let (answer, used_skills) = if skills.is_empty() {
    let answer = crate::research_llm::research_llm_completion(
      &settings,
      system,
      serde_json::Value::String(user),
      Some(ASK_MAX_TOKENS),
      ASK_TIMEOUT_SECS,
    )
    .await?;
    (answer, Vec::new())
  } else {
    ask_with_skills(&settings, &state.library_dir, system, user, &skills).await?
  };
  let now = Utc::now().to_rfc3339();
  messages.push(PaperExplainMessage { role: "user".into(), content: question, cites: None, skills: Vec::new(), created_at: now.clone() });
  messages.push(PaperExplainMessage { role: "assistant".into(), content: answer.trim().to_string(), cites: None, skills: used_skills, created_at: now });
  let pool = state.pool.read().await;
  save_messages(&pool, &id, &messages).await?;
  drop(pool);
  deepread_get(state, id).await
}

#[tauri::command]
pub async fn deepread_delete_turn(state: State<'_, AppState>, id: String, message_index: usize) -> Result<DeepReadDetail> {
  {
    let pool = state.pool.read().await;
    let mut messages = load_messages(&pool, &id).await?;
    remove_explain_turn(&mut messages, message_index)?;
    save_messages(&pool, &id, &messages).await?;
  }
  deepread_get(state, id).await
}

#[tauri::command]
pub async fn deepread_link_paper(state: State<'_, AppState>, id: String, paper_id: String) -> Result<DeepRead> {
  let pool = state.pool.read().await;
  sqlx::query("UPDATE deep_reads SET paper_id=?, source_kind='library', updated_at=? WHERE id=?")
    .bind(&paper_id)
    .bind(Utc::now().to_rfc3339())
    .bind(&id)
    .execute(&*pool)
    .await
    .map_err(err)?;
  load_task(&pool, &state.library_dir, &id).await
}

#[tauri::command]
pub async fn deepread_open_workspace(state: State<'_, AppState>, id: String) -> Result<()> {
  open::that(workspace_dir(&state.library_dir, &id)).map_err(err)
}

#[tauri::command]
pub async fn deepread_delete(state: State<'_, AppState>, id: String) -> Result<()> {
  if control().tokens.lock().await.contains_key(&id) {
    return Err("精读进行中，请先停止".into());
  }
  let pool = state.pool.read().await;
  delete_task(&pool, &state.library_dir, &id).await
}

async fn delete_task(pool: &SqlitePool, library_dir: &Path, id: &str) -> Result<()> {
  Uuid::parse_str(id).map_err(|_| "精读任务标识无效".to_string())?;
  let mut transaction = pool.begin().await.map_err(err)?;
  let deleted = sqlx::query("DELETE FROM deep_reads WHERE id=?").bind(id).execute(&mut *transaction).await.map_err(err)?;
  if deleted.rows_affected() == 0 {
    return Err("精读任务不存在".into());
  }
  let workspace = workspace_dir(library_dir, id);
  if workspace.exists() {
    fs::remove_dir_all(workspace).map_err(err)?;
  }
  transaction.commit().await.map_err(err)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn deletion_removes_task_and_workspace_but_preserves_library_pdf() {
    tauri::async_runtime::block_on(async {
      let root = std::env::temp_dir().join(format!("pn-delete-{}", Uuid::new_v4()));
      let id = Uuid::new_v4().to_string();
      let workspace = workspace_dir(&root, &id);
      fs::create_dir_all(workspace.join("figures")).unwrap();
      fs::write(workspace.join("report.md"), "report").unwrap();
      fs::write(workspace.join("figures/1.png"), b"image").unwrap();
      fs::write(root.join("original.pdf"), b"original PDF").unwrap();
      let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
      for statement in include_str!("schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
        sqlx::query(statement).execute(&pool).await.unwrap();
      }
      sqlx::query("INSERT INTO deep_reads(id,source_kind,title,source_name,status,messages_json,created_at,updated_at) VALUES(?,'external','T','t.pdf','completed','[{}]','t','t')")
        .bind(&id).execute(&pool).await.unwrap();
      delete_task(&pool, &root, &id).await.unwrap();
      assert!(!workspace.exists());
      let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM deep_reads").fetch_one(&pool).await.unwrap();
      assert_eq!(count, 0);
      assert_eq!(fs::read(root.join("original.pdf")).unwrap(), b"original PDF");
      fs::remove_dir_all(root).unwrap();
    });
  }

  #[test]
  fn deletion_keeps_record_when_workspace_cannot_be_removed() {
    tauri::async_runtime::block_on(async {
      let root = std::env::temp_dir().join(format!("pn-delete-error-{}", Uuid::new_v4()));
      let id = Uuid::new_v4().to_string();
      fs::create_dir_all(root.join("deepread")).unwrap();
      fs::write(workspace_dir(&root, &id), "not a directory").unwrap();
      let pool = SqlitePoolOptions::new().max_connections(1).connect("sqlite::memory:").await.unwrap();
      for statement in include_str!("schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
        sqlx::query(statement).execute(&pool).await.unwrap();
      }
      sqlx::query("INSERT INTO deep_reads(id,source_kind,title,source_name,status,created_at,updated_at) VALUES(?,'external','T','t.pdf','completed','t','t')")
        .bind(&id).execute(&pool).await.unwrap();
      assert!(delete_task(&pool, &root, &id).await.is_err());
      let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM deep_reads WHERE id=?").bind(&id).fetch_one(&pool).await.unwrap();
      assert_eq!(count, 1);
      assert!(delete_task(&pool, &root, "../outside").await.is_err());
      fs::remove_dir_all(root).unwrap();
    });
  }

  fn pages(texts: &[(i64, &[&str])]) -> Vec<SectionPage> {
    number_paragraphs(
      texts
        .iter()
        .map(|(page, paragraphs)| PageInput {
          page: *page,
          paragraphs: paragraphs.iter().map(|s| ParagraphInput { text: s.to_string(), rects: Vec::new() }).collect(),
        })
        .collect(),
    )
  }

  #[test]
  fn paragraphs_get_global_ids_and_drop_blanks() {
    let numbered = pages(&[(1, &["Abstract  text\nwrapped", "  "]), (2, &["Method"])]);
    assert_eq!(numbered[0].paragraphs.len(), 1);
    assert_eq!(numbered[0].paragraphs[0].id, "P0001");
    assert_eq!(numbered[0].paragraphs[0].text, "Abstract text wrapped");
    assert_eq!(numbered[1].paragraphs[0].id, "P0002");
  }

  #[test]
  fn v1_sections_without_rects_still_load() {
    let sections: Sections = serde_json::from_str(r#"{"pages":[{"page":1,"paragraphs":[{"id":"P0001","text":"Abstract"}]}]}"#).unwrap();
    assert!(sections.pages[0].paragraphs[0].rects.is_empty());
  }

  fn no_visuals() -> VisualContext {
    VisualContext { manifest: Vec::new(), analysis: serde_json::json!({"items": []}), plan: serde_json::json!({"items": [], "claims": []}) }
  }

  #[test]
  fn budget_matches_reference_figure_penalty() {
    assert_eq!(estimate_char_budget(120_000, 0), 48_000);
    assert_eq!(estimate_char_budget(120_000, 40), 42_000);
    assert_eq!(estimate_char_budget(30_000, 0), 24_000);
    assert_eq!(estimate_char_budget(10_000, 5), 10_000);
  }

  #[test]
  fn pack_keeps_everything_when_it_fits() {
    let p = pages(&[(1, &["Abstract: we study X.", "Intro."])]);
    let pack = build_stage_text_pack(&p, &["method"], &["abstract"], 10_000);
    assert!(pack.contains("[Page 1, P0001] Abstract: we study X."));
    assert!(pack.contains("[Page 1, P0002] Intro."));
  }

  #[test]
  fn pack_prefers_keywords_adds_neighbors_and_restores_order() {
    let filler = "x".repeat(400);
    let texts: Vec<String> = (0..20)
      .map(|i| match i {
        0 => "Abstract summary".to_string(),
        10 => format!("The loss function of our method {filler}"),
        11 => format!("Equation (3) defines {filler}"),
        _ => format!("unrelated {i} {filler}"),
      })
      .collect();
    let refs: Vec<&str> = texts.iter().map(String::as_str).collect();
    let p = pages(&[(1, &refs[..10]), (2, &refs[10..])]);
    let pack = build_stage_text_pack(&p, &["loss", "method"], &["abstract"], 1_400);
    let abstract_at = pack.find("P0001").unwrap();
    let loss_at = pack.find("P0011").unwrap();
    assert!(abstract_at < loss_at, "reading order restored");
    assert!(pack.contains("P0012") || pack.contains("P0010"), "neighbor paragraph added");
    assert!(!pack.contains("P0005"));
  }

  #[test]
  fn headings_detected_with_numbering() {
    let p = pages(&[(1, &["1 Introduction", "3.2 Method details", "We propose a method that is long enough"])]);
    let candidates = section_candidates(&p);
    assert!(candidates.contains("1 Introduction (Page 1, P0001)"));
    assert!(candidates.contains("3.2 Method details"));
    assert!(!candidates.contains("We propose"));
  }

  #[test]
  fn stage_message_carries_heading_skill_and_previous_sections() {
    let p = pages(&[(1, &["Abstract: we study X."])]);
    let previous = vec![("what", "## 1. What：做了什么\n内容".to_string())];
    let (system, user) = stage_messages(&REPORT_STAGES[1], "Paper T", "t.pdf", &p, &previous, &no_visuals()).unwrap();
    assert!(system.contains("图表必须自然融入"));
    assert!(user.contains("## 2. Why：为什么做"));
    assert!(user.contains("# Report Schema"));
    assert!(user.contains("# Global Visual Plan"));
    assert!(user.contains("# Figure And Table Manifest"));
    assert!(user.contains("## 1. What：做了什么\n内容"));
    assert!(user.contains("[Page 1, P0001]"));
  }

  fn section(heading: &str, body: &str) -> String {
    format!("{heading}\n\n{body}")
  }

  fn good_sections() -> Vec<(&'static str, String)> {
    REPORT_STAGES
      .iter()
      .map(|stage| (stage.key, section(stage.heading, "内容 $x$ (Evidence: p. 1, P0001)")))
      .collect()
  }

  #[test]
  fn assemble_strips_fences_and_stray_titles() {
    let mut sections = good_sections();
    sections[0].1 = format!("```markdown\n# 多余标题\n{}\n```", sections[0].1);
    let report = assemble_report("Paper T", &sections).unwrap();
    assert!(report.starts_with("# 论文精读报告：Paper T\n\n## 1. What"));
    assert!(!report.contains("多余标题"));
    assert!(validate_report(&report, &no_visuals()).is_empty(), "{:?}", validate_report(&report, &no_visuals()));
  }

  #[test]
  fn assemble_rejects_empty_stage() {
    let mut sections = good_sections();
    sections[2].1 = "  ".into();
    assert!(assemble_report("T", &sections).unwrap_err().contains("how"));
  }

  #[test]
  fn validation_flags_order_evidence_images_and_math() {
    let report = [
      "# 论文精读报告：T",
      "## 1. What：做了什么\n无证据",
      "## 2. How：如何实现\n(Evidence: p. 2)",
      "## 3. Why：为什么做\n(Evidence: p. 2) ![fig](a.png)",
      "## 4. Experiment：如何证明有效\n\\(x\\) (Evidence: p. 3)",
      "## 5. Question：评价与疑问\n$$ x $$ (Inference from Sec. 2)",
    ]
    .join("\n\n");
    let problems = validate_report(&report, &no_visuals());
    assert!(problems.iter().any(|p| p.contains("what 节缺少证据")));
    assert!(problems.iter().any(|p| p.contains("第 2 节应为 why")));
    assert!(problems.iter().any(|p| p.contains("插图不在 pdffigures2 提取清单中：a.png")));
    assert!(problems.iter().any(|p| p.contains("\\(")));
    assert!(problems.iter().any(|p| p.contains("独占一行")));
  }

  #[test]
  fn validation_counts_sections_and_unclosed_math() {
    let report = "# T\n\n## 1. What：做了什么\n$a (Evidence: p. 1)\n\nnext";
    let problems = validate_report(report, &no_visuals());
    assert!(problems.iter().any(|p| p.contains("实际 1 个")));
    assert!(problems.iter().any(|p| p.contains("未闭合")));
  }

  #[test]
  fn display_math_block_is_valid() {
    let report = good_sections().into_iter().map(|(_, s)| s).collect::<Vec<_>>().join("\n\n");
    let report = format!("# T\n\n{report}\n\n$$\nL = L_1 + \\lambda L_2\n$$\n");
    assert!(validate_report(&report, &no_visuals()).is_empty(), "{:?}", validate_report(&report, &no_visuals()));
  }

  #[test]
  fn question_keywords_keep_ascii_terms() {
    let words = question_keywords("Table 3 里 BLEU 提升来自哪个 loss？");
    assert!(words.contains(&"table".to_string()));
    assert!(words.contains(&"bleu".to_string()));
    assert!(words.contains(&"loss".to_string()));
    assert!(!words.contains(&"3".to_string()));
  }

  #[test]
  fn deep_reads_table_cascades_paper_deletion_to_null() {
    tauri::async_runtime::block_on(async {
      let options = SqliteConnectOptions::from_str("sqlite::memory:").unwrap().foreign_keys(true);
      let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
      for statement in include_str!("schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
        sqlx::query(statement).execute(&pool).await.unwrap();
      }
      sqlx::query("INSERT INTO papers(id,title_en,created_at,updated_at) VALUES('p1','T','t','t')").execute(&pool).await.unwrap();
      sqlx::query("INSERT INTO deep_reads(id,paper_id,source_kind,title,source_name,status,created_at,updated_at) VALUES('d1','p1','library','T','t.pdf','running','t','t')")
        .execute(&pool)
        .await
        .unwrap();
      reset_interrupted(&pool).await.unwrap();
      sqlx::query("DELETE FROM papers WHERE id='p1'").execute(&pool).await.unwrap();
      let row = sqlx::query("SELECT paper_id, status FROM deep_reads WHERE id='d1'").fetch_one(&pool).await.unwrap();
      assert_eq!(row.get::<Option<String>, _>("paper_id"), None);
      assert_eq!(row.get::<String, _>("status"), "failed");
    });
  }
}
