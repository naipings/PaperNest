//! 论文精读插图：pdffigures2 提取 → 逐图多模态预读 → 全局选图计划 → 报告插图校验。
//! 提示词与校验规则移植自 evidence-grounded-paper-deep-read（MIT）的
//! pipeline.py、visuals.py、visual_plan.py、visual_contract.py。
use super::*;
use crate::deepread::SectionPage;
use crate::research::ResearchLlmSettings;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub(crate) const FIGURES_DIR: &str = "figures";
pub(crate) const MANIFEST_FILE: &str = "figure_manifest.json";
pub(crate) const ANALYSIS_FILE: &str = "visual_analysis.json";
pub(crate) const PLAN_FILE: &str = "visual_plan.json";
pub(crate) const VISUALS_DIR: &str = "visuals";
const SECTIONS: [&str; 6] = ["what", "why", "how", "experiment", "question", "none"];
const VISUAL_MAX_TOKENS: u32 = 2_000;
const VISUAL_TIMEOUT_SECS: u64 = 180;
const PLAN_MAX_TOKENS: u32 = 6_000;
const PLAN_TIMEOUT_SECS: u64 = 300;
const CONTEXT_CHARS: usize = 24_000;
const PLAN_PAPER_CHARS: usize = 36_000;

const PLAN_INSTRUCTIONS: &str = r#"根据已完成的全部实图预读，先形成全局选图与贡献证据覆盖计划，暂时不要写正文。
How：技术路线、整体架构、关键模块、训练/推理流程及机制示意图，去重后应尽量全部展示讲解。
同一模块不等于同一信息：总流程图与局部机制图通常互补，应同时保留。
只有另一张图完整覆盖了该图的技术信息时才能以 duplicate_of 去重，并写明具体重合内容和保留代表。
同一技术信息在 covers 中使用完全相同的名称；被去重图的 covers 必须是代表图 covers 的子集，不能遗漏独特技术信息。
不能仅因篇幅、附录来源或单图 selected=false 就省略独立的方法图；不可读/提取失败须明确限制。
Experiment：先区分论文核心贡献的直接证据与辅助诊断，按论文目标建立证明链，自主选择图表，不凑数量。
效果、泛化、标注效率等核心贡献各自检查；每条实验证明链优先选择一个最能说明结果与边界的代表图表。
不同视角、粒度、参数检查不自动构成独立核心贡献。冻结/微调等确有不同结论的设置可以分别展示。
同一证明链追加第二张图表，必须说明新增信息为何对判断核心结论不可缺少、为何不能用一两句准确文字承载。
训练诊断、层选择、采样敏感性、逐受试者明细、探索性分析的补充视角通常用文字引用；若支撑关键质疑或核心结论才展示。
不要逐张把“有新信息”当成必须展示；不要为了覆盖分析记录而接近全量插入实验图。
也不能把多条独立核心证明链笼统以“简洁”为由全部改成文字；仅文字呈现需具体理由。
逐项决定所有图表，含不展示项目。section 原来为 how 且可读的图只能在 how 中 include=true，
或指向另一张已选 how 图作为 duplicate_of。图表不能凭空改路径。
只输出 JSON 对象：
{
 "items": [{"id":"Figure 1","image":"figures/xxx.png","section":"how",
            "include":true,"duplicate_of":"","covers":["输入→预训练→下游输出"],"reason":"具体选择理由"}],
 "claims": [{"claim":"一项核心贡献或设计目标","evidence":["Sec. 3, Fig. 4"],
             "visuals":["Figure 4"],"presentation":"image","reason":"为何需要展示或为何文字足够"}]
}
section 取 what/why/how/experiment/question/none。id 必须为 manifest 的 figType + 空格 + name。
include=false 也必须写 reason；duplicate_of 使用代表图 id，非重复时为空字符串。
claims 覆盖论文核心贡献，不只列平均准确率；presentation 取 image/text，image 必须有已选图支持。"#;

#[derive(Clone, Serialize, Deserialize)]
pub struct Boundary {
  pub x1: f64,
  pub y1: f64,
  pub x2: f64,
  pub y2: f64,
}

/// pdffigures2 提取的一张图/表；`page` 为从 1 开始的 PDF 页码，`image` 为工作区相对路径（未生成图片时为空）。
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureItem {
  pub name: String,
  pub fig_type: String,
  pub page: i64,
  pub caption: String,
  pub image: String,
  pub region_boundary: Boundary,
  pub caption_boundary: Boundary,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
  items: Vec<FigureItem>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawFigure {
  name: String,
  fig_type: String,
  page: i64,
  caption: String,
  #[serde(rename = "renderURL")]
  render_url: String,
  region_boundary: Boundary,
  caption_boundary: Boundary,
}

pub(crate) struct VisualContext {
  pub manifest: Vec<FigureItem>,
  pub analysis: Value,
  pub plan: Value,
}

fn str_of<'a>(value: &'a Value, key: &str) -> &'a str {
  value.get(key).and_then(Value::as_str).unwrap_or("")
}

fn visual_id(item: &Value) -> String {
  format!("{} {}", str_of(item, "figType"), str_of(item, "name"))
}

pub(crate) fn read_json(path: &Path) -> Result<Value> {
  serde_json::from_str(&fs::read_to_string(path).map_err(err)?).map_err(err)
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<()> {
  fs::write(path, serde_json::to_vec_pretty(value).map_err(err)?).map_err(err)
}

fn sort_key(item: &FigureItem) -> (u64, String) {
  let digits: String = item.name.chars().filter(char::is_ascii_digit).collect();
  (digits.parse().unwrap_or(10_000), item.name.clone())
}

pub(crate) fn manifest_from_pdffigures2(raw: &str, figures_dir: &Path) -> Result<Vec<FigureItem>> {
  let raw: Vec<RawFigure> = serde_json::from_str(raw).map_err(err)?;
  let mut items: Vec<FigureItem> = raw
    .into_iter()
    .map(|figure| {
      let file = Path::new(&figure.render_url).file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
      let image = if !file.is_empty() && figures_dir.join(&file).is_file() { format!("{FIGURES_DIR}/{file}") } else { String::new() };
      FigureItem {
        name: figure.name,
        fig_type: figure.fig_type,
        page: figure.page + 1,
        caption: figure.caption,
        image,
        region_boundary: figure.region_boundary,
        caption_boundary: figure.caption_boundary,
      }
    })
    .collect();
  items.sort_by_key(sort_key);
  Ok(items)
}

pub(crate) fn load_manifest(workspace: &Path) -> Result<Vec<FigureItem>> {
  let path = workspace.join(MANIFEST_FILE);
  if !path.exists() {
    return Ok(Vec::new());
  }
  Ok(serde_json::from_str::<Manifest>(&fs::read_to_string(path).map_err(err)?).map_err(err)?.items)
}

/// 运行随应用打包的 pdffigures2，图片写入 `figures/`，清单写入 `figure_manifest.json`。
pub(crate) async fn extract_figures(pdffigures2_dir: &Path, pdf: &Path, workspace: &Path) -> Result<Vec<FigureItem>> {
  let input = workspace.join(".pdffigures2-input");
  let data = workspace.join(".pdffigures2-data");
  let figures = workspace.join(FIGURES_DIR);
  for dir in [&input, &data, &figures] {
    if dir.exists() {
      fs::remove_dir_all(dir).map_err(err)?;
    }
    fs::create_dir_all(dir).map_err(err)?;
  }
  fs::copy(pdf, input.join("paper.pdf")).map_err(err)?;
  let mut command = Command::new(pdffigures2_dir.join("runtime").join("bin").join("java.exe"));
  command
    .arg("-Dfile.encoding=UTF-8")
    .arg("-Dsun.java2d.cmm=sun.java2d.cmm.kcms.KcmsServiceProvider")
    .arg("-Duser.language=en")
    .arg("-jar")
    .arg(pdffigures2_dir.join("pdffigures2.jar"))
    .arg(&input)
    .arg("-m")
    .arg(format!("{}{}", figures.display(), std::path::MAIN_SEPARATOR))
    .arg("-d")
    .arg(format!("{}{}", data.display(), std::path::MAIN_SEPARATOR));
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
  }
  let output = tokio::task::spawn_blocking(move || command.output())
    .await
    .map_err(err)?
    .map_err(|error| format!("无法启动 pdffigures2：{error}"))?;
  if !output.status.success() {
    let log = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    let tail: String = log.chars().rev().take(1_500).collect::<Vec<_>>().into_iter().rev().collect();
    return Err(format!("pdffigures2 提取图表失败：{tail}"));
  }
  let items = manifest_from_pdffigures2(&fs::read_to_string(data.join("paper.json")).map_err(err)?, &figures)?;
  fs::remove_dir_all(&input).map_err(err)?;
  fs::remove_dir_all(&data).map_err(err)?;
  write_json(&workspace.join(MANIFEST_FILE), &Manifest { items: items.clone() })?;
  Ok(items)
}

fn reference_pattern(item: &FigureItem) -> Regex {
  let kind = if item.fig_type.eq_ignore_ascii_case("table") { "Tables?" } else { r"Fig(?:ure)?s?\.?" };
  Regex::new(&format!(r"(?i)\b{kind}\s+{}\b", regex::escape(&item.name))).expect("escaped figure name")
}

/// 首页、图表所在页 ±1 页，以及正文引用该图表的页。
pub(crate) fn nearby_context(item: &FigureItem, pages: &[SectionPage]) -> String {
  let pattern = reference_pattern(item);
  let lines: Vec<String> = pages
    .iter()
    .filter(|page| page.page == 1 || (page.page - item.page).abs() <= 1 || page.paragraphs.iter().any(|p| pattern.is_match(&p.text)))
    .flat_map(|page| page.paragraphs.iter().map(move |p| format!("[Page {}, {}] {}", page.page, p.id, p.text)))
    .collect();
  lines.join("\n").chars().take(CONTEXT_CHARS).collect()
}

pub(crate) fn parse_json_object(content: &str) -> Result<Value> {
  let trimmed = content.trim();
  let body = if trimmed.starts_with("```") {
    let inner = trimmed.trim_start_matches("```").trim_end_matches("```");
    inner.strip_prefix("json").unwrap_or(inner).trim()
  } else {
    trimmed
  };
  let value: Value = serde_json::from_str(body).map_err(|_| "模型没有返回合法 JSON".to_string())?;
  if !value.is_object() {
    return Err("模型应返回 JSON 对象".into());
  }
  Ok(value)
}

pub(crate) fn analysis_problem(analysis: &Value) -> Option<&'static str> {
  if ["summary", "observation", "supports", "limitation", "reason"].iter().any(|field| str_of(analysis, field).trim().is_empty()) {
    return Some("缺少 summary/observation/supports/limitation/reason");
  }
  let section = str_of(analysis, "section");
  let Some(selected) = analysis.get("selected").and_then(Value::as_bool) else { return Some("selected 应为布尔值") };
  if !SECTIONS.contains(&section) || (selected && section == "none") {
    return Some("section 无效");
  }
  let Some(readable) = analysis.get("readable").and_then(Value::as_bool) else { return Some("readable 应为布尔值") };
  if !readable && selected {
    return Some("不可读的图表不能 selected");
  }
  let anchors = analysis.get("evidence").and_then(Value::as_array);
  if !anchors.is_some_and(|items| !items.is_empty() && items.iter().all(|a| a.as_str().is_some_and(|s| !s.trim().is_empty()))) {
    return Some("缺少证据锚点 evidence");
  }
  None
}

/// 单张图/表预读；结果缓存在 `visuals/NNNN.json`，中断后继续生成时跳过已完成的图。
pub(crate) async fn analyze_visual(
  settings: &ResearchLlmSettings,
  workspace: &Path,
  index: usize,
  item: &FigureItem,
  pages: &[SectionPage],
) -> Result<Value> {
  let mut record = serde_json::to_value(item).map_err(err)?;
  if item.image.is_empty() {
    record["status"] = json!("unavailable");
    record["selected"] = json!(false);
    record["section"] = json!("none");
    record["reason"] = json!("pdffigures2 未生成图片，只能依据图注与正文。");
    return Ok(record);
  }
  let cache = workspace.join(VISUALS_DIR).join(format!("{index:04}.json"));
  let analysis = if cache.exists() {
    read_json(&cache)?
  } else {
    let prompt = format!(
      "先分析这一张论文图/表，暂时不要写报告。分析语言：简体中文。
元数据：{metadata}
实际 PDF 页码（从 1 开始）：{page}
结合图片、图注和上下文解释内容；看不清的数字不能从图注猜出。
识别模块/箭头或行列/指标方向，记录关键观察、支持的作者主张、证明边界。
判断是否值得放入简洁的 what → why → how → experiment → question 报告；
不凑图数，重复或次要图表 selected=false。
只输出 JSON 对象，包含非空字符串 summary、observation、supports、limitation、reason、
section（what/why/how/experiment/question/none），布尔值 selected，
布尔值 readable（关键图像内容是否可读），以及非空字符串列表 evidence（真实页码/图号/表号/段落）。
readable=false 时 selected=false，并说明读图限制。
上下文：
{context}
",
      metadata = serde_json::to_string(item).map_err(err)?,
      page = item.page,
      context = nearby_context(item, pages),
    );
    let bytes = fs::read(workspace.join(&item.image)).map_err(err)?;
    let content = json!([
      {"type": "text", "text": prompt},
      {"type": "image_url", "image_url": {"url": format!("data:image/png;base64,{}", BASE64.encode(bytes)), "detail": "high"}}
    ]);
    let answer = crate::research_llm::research_llm_completion(
      settings,
      "实际看图并核对正文，不能编造看不清的内容。",
      content,
      Some(VISUAL_MAX_TOKENS),
      VISUAL_TIMEOUT_SECS,
    )
    .await
    .map_err(|error| format!("{} {} 看图预读失败（需要支持图片输入的模型）：{error}", item.fig_type, item.name))?;
    let analysis = parse_json_object(&answer).map_err(|error| format!("{} {} 看图预读：{error}", item.fig_type, item.name))?;
    if let Some(problem) = analysis_problem(&analysis) {
      return Err(format!("{} {} 看图预读结果无效：{problem}", item.fig_type, item.name));
    }
    fs::create_dir_all(workspace.join(VISUALS_DIR)).map_err(err)?;
    write_json(&cache, &analysis)?;
    analysis
  };
  let readable = analysis["readable"].as_bool() == Some(true);
  for (key, value) in analysis.as_object().into_iter().flatten() {
    record[key] = value.clone();
  }
  record["status"] = json!(if readable { "analyzed" } else { "unreadable" });
  Ok(record)
}

/// 汇总预读记录，并列出正文提到但未提取到的图表（只作可能遗漏的线索）。
pub(crate) fn finish_analysis(workspace: &Path, records: Vec<Value>, pages: &[SectionPage]) -> Result<Value> {
  let mention = Regex::new(r"(?i)\b(Fig(?:ure)?s?\.?|Tables?)\s+([0-9]+|[IVX]+)\b").expect("static pattern");
  let identity = |kind: &str, name: &str| {
    (if kind.to_lowercase().starts_with("table") { "table" } else { "figure" }, name.to_uppercase())
  };
  let extracted: HashSet<(&str, String)> = records.iter().map(|r| identity(str_of(r, "figType"), str_of(r, "name"))).collect();
  let mut unmatched: Vec<String> = pages
    .iter()
    .flat_map(|page| &page.paragraphs)
    .flat_map(|p| mention.captures_iter(&p.text).map(|c| identity(&c[1], &c[2])).collect::<Vec<_>>())
    .filter(|key| !extracted.contains(key))
    .map(|(kind, name)| format!("{kind} {name}"))
    .collect::<HashSet<_>>()
    .into_iter()
    .collect();
  unmatched.sort();
  let analysis = json!({
    "items": records,
    "unmatched_text_references": unmatched,
    "coverage_note": "正文提及只是可能遗漏的线索；缺失的图表不会用其他工具裁剪补图。",
  });
  write_json(&workspace.join(ANALYSIS_FILE), &analysis)?;
  Ok(analysis)
}

pub(crate) fn plan_problems(plan: &Value, analysis: &Value) -> Vec<String> {
  let mut problems = Vec::new();
  let no_items = Vec::new();
  let source_items = analysis.get("items").and_then(Value::as_array).unwrap_or(&no_items);
  let source: HashMap<String, &Value> = source_items.iter().map(|item| (visual_id(item), item)).collect();
  let Some(items) = plan.get("items").and_then(Value::as_array).filter(|items| items.iter().all(Value::is_object)) else {
    return vec!["选图计划 items 必须是对象列表".into()];
  };
  if items.iter().any(|item| !item.get("id").is_some_and(Value::is_string)) {
    return vec!["选图计划的 id 必须是字符串".into()];
  }
  let decisions: HashMap<&str, &Value> = items.iter().map(|item| (str_of(item, "id"), item)).collect();
  let decided: HashSet<&str> = decisions.keys().copied().collect();
  let sourced: HashSet<&str> = source.keys().map(String::as_str).collect();
  if decisions.len() != items.len() || decided != sourced {
    problems.push("选图计划必须对每张已分析图表恰好决定一次".into());
  }
  for decision in items {
    let identity = str_of(decision, "id");
    let Some(original) = source.get(identity) else { continue };
    let include = decision.get("include").and_then(Value::as_bool);
    let section = str_of(decision, "section");
    let duplicate = match decision.get("duplicate_of") {
      None => "",
      Some(Value::String(target)) => target.as_str(),
      Some(_) => {
        problems.push(format!("duplicate_of 无效：{identity}"));
        ""
      }
    };
    if include.is_none() || !SECTIONS.contains(&section) {
      problems.push(format!("选图决定无效：{identity}"));
    }
    let include = include.unwrap_or(false);
    if str_of(decision, "reason").trim().is_empty() {
      problems.push(format!("缺少选图理由：{identity}"));
    }
    let topics = decision.get("covers").and_then(Value::as_array);
    let topics_valid = topics.is_some_and(|list| list.iter().all(|t| t.as_str().is_some_and(|s| !s.trim().is_empty())));
    if !topics_valid || (include && topics.is_none_or(Vec::is_empty)) {
      problems.push(format!("缺少信息覆盖 covers：{identity}"));
    }
    if decision.get("image").and_then(Value::as_str) != Some(str_of(original, "image")) {
      problems.push(format!("选图计划改动了图片路径：{identity}"));
    }
    let usable = str_of(original, "status") == "analyzed" && !str_of(original, "image").is_empty();
    if include && (!usable || section == "none" || !duplicate.is_empty()) {
      problems.push(format!("不可用或重复的图表不能插入：{identity}"));
    }
    if !duplicate.is_empty() {
      let target = decisions.get(duplicate);
      let target_include = target.and_then(|t| t.get("include")).and_then(Value::as_bool) == Some(true);
      if include || !target_include || duplicate == identity {
        problems.push(format!("duplicate_of 必须直接指向已插入的代表图：{identity}"));
      }
      if str_of(original, "section") == "how" && target.map(|t| str_of(t, "section")) != Some("how") {
        problems.push(format!("方法图的重复代表必须是 How 图：{identity}"));
      }
      let target_topics = target.and_then(|t| t.get("covers")).and_then(Value::as_array);
      let covered = match (topics, target_topics) {
        (Some(own), Some(theirs)) if !own.is_empty() => own.iter().all(|topic| theirs.contains(topic)),
        _ => false,
      };
      if !covered {
        problems.push(format!("代表图没有覆盖全部技术信息：{identity}"));
      }
    }
    if usable && str_of(original, "section") == "how" {
      if include && section != "how" {
        problems.push(format!("技术路线图应放在 How：{identity}"));
      }
      if !include && duplicate.is_empty() {
        problems.push(format!("方法图被省略但没有重复代表：{identity}"));
      }
    }
  }
  match plan.get("claims").and_then(Value::as_array) {
    Some(claims) if !claims.is_empty() => {
      for claim in claims {
        if !claim.is_object() {
          problems.push("核心贡献记录无效".into());
          continue;
        }
        if ["claim", "reason"].iter().any(|key| str_of(claim, key).trim().is_empty()) {
          problems.push("核心贡献需要 claim 与具体理由".into());
        }
        let anchors = claim.get("evidence").and_then(Value::as_array);
        if !anchors.is_some_and(|list| !list.is_empty() && list.iter().all(|a| a.as_str().is_some_and(|s| !s.trim().is_empty()))) {
          problems.push("核心贡献需要真实证据锚点".into());
        }
        let references = claim.get("visuals").and_then(Value::as_array);
        let Some(references) = references.filter(|list| list.iter().all(|r| r.as_str().is_some_and(|s| source.contains_key(s)))) else {
          problems.push("核心贡献引用了不存在的图表".into());
          continue;
        };
        let presentation = str_of(claim, "presentation");
        if presentation != "image" && presentation != "text" {
          problems.push("presentation 只能是 image 或 text".into());
        }
        let supported = references.iter().any(|r| {
          decisions.get(r.as_str().unwrap_or("")).and_then(|d| d.get("include")).and_then(Value::as_bool) == Some(true)
        });
        if presentation == "image" && !supported {
          problems.push(format!("核心贡献没有已选图表支持：{}", str_of(claim, "claim")));
        }
      }
    }
    _ => problems.push("选图计划必须把核心贡献映射到证据与呈现方式（claims）".into()),
  }
  problems
}

pub(crate) fn paper_text(pages: &[SectionPage]) -> String {
  let text = pages
    .iter()
    .flat_map(|page| page.paragraphs.iter().map(move |p| format!("[Page {}, {}] {}", page.page, p.id, p.text)))
    .collect::<Vec<_>>()
    .join("\n\n");
  text.chars().take(PLAN_PAPER_CHARS).collect()
}

/// 全局选图计划；校验不通过时带问题列表修正一次，仍不通过则失败。
pub(crate) async fn build_plan(settings: &ResearchLlmSettings, workspace: &Path, analysis: &Value, pages: &[SectionPage]) -> Result<Value> {
  let mut messages = vec![
    json!({"role": "system", "content": PLAN_INSTRUCTIONS}),
    json!({"role": "user", "content": format!(
      "计划语言：简体中文\n# Paper Text\n{}\n# All Visual Analyses\n{}",
      paper_text(pages),
      serde_json::to_string(analysis).map_err(err)?
    )}),
  ];
  let mut plan = Value::Null;
  for attempt in 0..2 {
    let response = crate::research_llm::research_llm_with_tools(settings, &messages, &[], Some(PLAN_MAX_TOKENS), PLAN_TIMEOUT_SECS).await?;
    let answer = response.content.ok_or_else(|| "选图计划响应为空".to_string())?;
    plan = parse_json_object(&answer).map_err(|error| format!("选图计划：{error}"))?;
    let problems = plan_problems(&plan, analysis);
    if problems.is_empty() {
      break;
    }
    if attempt == 1 {
      return Err(format!("选图计划无效：{}", problems.join("；")));
    }
    messages.push(json!({"role": "assistant", "content": answer}));
    messages.push(json!({"role": "user", "content": format!("请修正以下计划问题，只输出完整 JSON；不得丢弃独立方法图：\n{}", problems.join("\n"))}));
  }
  write_json(&workspace.join(PLAN_FILE), &plan)?;
  Ok(plan)
}

pub(crate) fn write_empty_plan(workspace: &Path) -> Result<Value> {
  let plan = json!({"items": [], "claims": []});
  write_json(&workspace.join(PLAN_FILE), &plan)?;
  Ok(plan)
}

pub(crate) fn load_context(workspace: &Path) -> Result<VisualContext> {
  Ok(VisualContext {
    manifest: load_manifest(workspace)?,
    analysis: read_json(&workspace.join(ANALYSIS_FILE))?,
    plan: read_json(&workspace.join(PLAN_FILE))?,
  })
}

fn without_fences(text: &str) -> String {
  Regex::new(r"(?s)```.*?```").expect("static pattern").replace_all(text, "").into_owned()
}

fn image_paths(text: &str) -> Vec<String> {
  Regex::new(r"!\[[^\]]*\]\(([^)]+)\)")
    .expect("static pattern")
    .captures_iter(text)
    .map(|c| c[1].trim().trim_matches(|ch| ch == '<' || ch == '>').to_string())
    .collect()
}

/// 计划中 include=true 的图必须出现在指定章节；未入计划的插图报错。
pub(crate) fn coverage_problems(text: &str, plan: &Value) -> Vec<String> {
  let prose = without_fences(text);
  let heading = Regex::new(r"(?mi)^##\s+\d+\.\s+(What|Why|How|Experiment|Question)\b.*$").expect("static pattern");
  let heads: Vec<(usize, usize, String)> = heading.captures_iter(&prose).map(|c| (c.get(0).unwrap().start(), c.get(0).unwrap().end(), c[1].to_lowercase())).collect();
  let mut bodies: HashMap<String, &str> = HashMap::new();
  for (index, (_, end, key)) in heads.iter().enumerate() {
    let stop = heads.get(index + 1).map(|(start, _, _)| *start).unwrap_or(prose.len());
    bodies.insert(key.clone(), &prose[*end..stop]);
  }
  let mut problems = Vec::new();
  let mut included = HashSet::new();
  for item in plan.get("items").and_then(Value::as_array).into_iter().flatten() {
    if item.get("include").and_then(Value::as_bool) != Some(true) {
      continue;
    }
    let path = str_of(item, "image").to_string();
    let section = str_of(item, "section");
    if !image_paths(bodies.get(section).copied().unwrap_or("")).contains(&path) {
      problems.push(format!("计划插入的图表未出现在 {section} 节：{}", str_of(item, "id")));
    }
    included.insert(path);
  }
  let mut stray: Vec<String> = image_paths(&prose).into_iter().filter(|path| !included.contains(path)).collect::<HashSet<_>>().into_iter().collect();
  stray.sort();
  problems.extend(stray.into_iter().map(|path| format!("插图不在全局选图计划中：{path}")));
  problems
}

/// 插图必须出自 pdffigures2 清单且写作前已预读，不得重复插入。
pub(crate) fn image_problems(text: &str, context: &VisualContext) -> Vec<String> {
  let allowed: HashSet<&str> = context.manifest.iter().filter(|item| !item.image.is_empty()).map(|item| item.image.as_str()).collect();
  let analyzed: HashSet<&str> = context
    .analysis
    .get("items")
    .and_then(Value::as_array)
    .into_iter()
    .flatten()
    .filter(|item| str_of(item, "status") == "analyzed")
    .map(|item| str_of(item, "image"))
    .collect();
  let mut problems = Vec::new();
  let mut seen = HashSet::new();
  for image in image_paths(&without_fences(text)) {
    if !seen.insert(image.clone()) {
      problems.push(format!("重复插图：{image}"));
    }
    if !allowed.contains(image.as_str()) {
      problems.push(format!("插图不在 pdffigures2 提取清单中：{image}"));
    }
    if !analyzed.contains(image.as_str()) {
      problems.push(format!("插图写作前未经预读：{image}"));
    }
  }
  problems
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::deepread::Paragraph;

  #[test]
  #[ignore = "requires PAPERNEST_TEST_PDF and the bundled Java runtime"]
  fn extracts_real_pdf_with_utf8() {
    let pdf = PathBuf::from(std::env::var("PAPERNEST_TEST_PDF").expect("PDF fixture path"));
    let runtime = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/pdffigures2");
    let workspace = std::env::temp_dir().join(format!("pn-utf8-{}", Uuid::new_v4()));
    fs::create_dir_all(&workspace).unwrap();
    let items = tauri::async_runtime::block_on(extract_figures(&runtime, &pdf, &workspace)).unwrap();
    assert!(!items.is_empty());
    assert!(items.iter().filter(|item| !item.image.is_empty()).all(|item| workspace.join(&item.image).is_file()));
    let raw = fs::read_to_string(workspace.join(MANIFEST_FILE)).unwrap();
    assert!(!raw.contains('\u{fffd}'));
    println!("extracted {} figures/tables as UTF-8 from {}", items.len(), pdf.display());
    fs::remove_dir_all(workspace).unwrap();
  }

  fn boundary() -> Value {
    json!({"x1": 1.0, "y1": 2.0, "x2": 3.0, "y2": 4.0})
  }

  fn page(number: i64, texts: &[(&str, &str)]) -> SectionPage {
    SectionPage {
      page: number,
      paragraphs: texts.iter().map(|(id, text)| Paragraph { id: id.to_string(), text: text.to_string(), rects: Vec::new() }).collect(),
    }
  }

  fn record(id: &str, section: &str, status: &str) -> Value {
    let (kind, name) = id.split_once(' ').unwrap();
    json!({"figType": kind, "name": name, "image": format!("figures/{name}.png"), "section": section, "status": status})
  }

  fn decision(id: &str, section: &str, include: bool, duplicate: &str, covers: &[&str]) -> Value {
    let name = id.split_once(' ').unwrap().1;
    json!({"id": id, "image": format!("figures/{name}.png"), "section": section, "include": include,
           "duplicate_of": duplicate, "covers": covers, "reason": "理由"})
  }

  fn claims() -> Value {
    json!([{"claim": "效果", "evidence": ["Table 1"], "visuals": ["Table 1"], "presentation": "image", "reason": "主结果"}])
  }

  #[test]
  fn manifest_converts_pages_paths_and_order() {
    let dir = std::env::temp_dir().join(format!("pn-manifest-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("paper-Figure2-1.png"), b"png").unwrap();
    fs::write(dir.join("paper-Table1-1.png"), b"png").unwrap();
    let raw = json!([
      {"name": "2", "figType": "Figure", "page": 3, "caption": "Figure 2", "renderURL": dir.join("paper-Figure2-1.png"), "regionBoundary": boundary(), "captionBoundary": boundary()},
      {"name": "1", "figType": "Table", "page": 0, "caption": "Table 1", "renderURL": dir.join("paper-Table1-1.png"), "regionBoundary": boundary(), "captionBoundary": boundary()},
      {"name": "3", "figType": "Figure", "page": 5, "caption": "Figure 3", "renderURL": dir.join("missing.png"), "regionBoundary": boundary(), "captionBoundary": boundary()}
    ]);
    let items = manifest_from_pdffigures2(&raw.to_string(), &dir).unwrap();
    fs::remove_dir_all(&dir).unwrap();
    assert_eq!(items.iter().map(|i| format!("{} {}", i.fig_type, i.name)).collect::<Vec<_>>(), ["Table 1", "Figure 2", "Figure 3"]);
    assert_eq!(items[0].page, 1);
    assert_eq!(items[1].image, "figures/paper-Figure2-1.png");
    assert_eq!(items[2].image, "");
  }

  #[test]
  fn nearby_context_takes_first_adjacent_and_referencing_pages() {
    let item = FigureItem {
      name: "4".into(),
      fig_type: "Figure".into(),
      page: 5,
      caption: String::new(),
      image: String::new(),
      region_boundary: Boundary { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 },
      caption_boundary: Boundary { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 },
    };
    let pages = [
      page(1, &[("P0001", "abstract")]),
      page(2, &[("P0002", "unrelated")]),
      page(4, &[("P0003", "before")]),
      page(8, &[("P0004", "As shown in Fig. 4, results")]),
      page(9, &[("P0005", "Figure 40 is different")]),
    ];
    let context = nearby_context(&item, &pages);
    for id in ["P0001", "P0003", "P0004"] {
      assert!(context.contains(id), "{id}");
    }
    assert!(!context.contains("P0002"));
    assert!(!context.contains("P0005"));
  }

  #[test]
  fn json_object_parsing_strips_fences() {
    assert_eq!(parse_json_object("```json\n{\"a\": 1}\n```").unwrap()["a"], 1);
    assert!(parse_json_object("[1]").is_err());
    assert!(parse_json_object("not json").is_err());
  }

  #[test]
  fn analysis_requires_fields_and_consistent_flags() {
    let good = json!({"summary": "s", "observation": "o", "supports": "c", "limitation": "l", "reason": "r",
                      "section": "how", "selected": true, "readable": true, "evidence": ["p. 3"]});
    assert_eq!(analysis_problem(&good), None);
    let mut unreadable = good.clone();
    unreadable["readable"] = json!(false);
    assert!(analysis_problem(&unreadable).is_some());
    let mut no_evidence = good.clone();
    no_evidence["evidence"] = json!([]);
    assert!(analysis_problem(&no_evidence).is_some());
    let mut missing = good;
    missing["summary"] = json!(" ");
    assert!(analysis_problem(&missing).is_some());
  }

  #[test]
  fn plan_accepts_complete_decisions() {
    let analysis = json!({"items": [record("Figure 1", "how", "analyzed"), record("Figure 2", "how", "analyzed"), record("Table 1", "experiment", "analyzed")]});
    let plan = json!({"items": [
      decision("Figure 1", "how", true, "", &["总流程", "检索"]),
      decision("Figure 2", "how", false, "Figure 1", &["检索"]),
      decision("Table 1", "experiment", true, "", &["主结果"])
    ], "claims": claims()});
    assert!(plan_problems(&plan, &analysis).is_empty(), "{:?}", plan_problems(&plan, &analysis));
  }

  #[test]
  fn plan_flags_dropped_method_figure_partial_duplicate_and_path_change() {
    let analysis = json!({"items": [record("Figure 1", "how", "analyzed"), record("Figure 2", "how", "analyzed"), record("Figure 3", "how", "analyzed")]});
    let mut moved = decision("Figure 1", "how", true, "", &["总流程"]);
    moved["image"] = json!("figures/other.png");
    let plan = json!({"items": [
      moved,
      decision("Figure 2", "how", false, "Figure 1", &["检索"]),
      decision("Figure 3", "how", false, "", &["更新"])
    ], "claims": []});
    let problems = plan_problems(&plan, &analysis);
    assert!(problems.iter().any(|p| p.contains("改动了图片路径")));
    assert!(problems.iter().any(|p| p.contains("代表图没有覆盖全部技术信息：Figure 2")));
    assert!(problems.iter().any(|p| p.contains("方法图被省略但没有重复代表：Figure 3")));
    assert!(problems.iter().any(|p| p.contains("claims")));
  }

  #[test]
  fn plan_must_decide_every_figure() {
    let analysis = json!({"items": [record("Figure 1", "how", "analyzed"), record("Table 1", "experiment", "analyzed")]});
    let plan = json!({"items": [decision("Figure 1", "how", true, "", &["总流程"])], "claims": claims()});
    assert!(plan_problems(&plan, &analysis).iter().any(|p| p.contains("恰好决定一次")));
  }

  #[test]
  fn coverage_requires_planned_images_in_their_sections() {
    let plan = json!({"items": [decision("Figure 1", "how", true, "", &["总流程"]), decision("Table 1", "experiment", false, "", &[])]});
    let good = "# T\n\n## 3. How：如何实现\n![图 1](figures/1.png)\n\n## 4. Experiment：如何证明有效\n文字";
    assert!(coverage_problems(good, &plan).is_empty());
    let misplaced = "# T\n\n## 3. How：如何实现\n文字\n\n## 4. Experiment：如何证明有效\n![图 1](figures/1.png)\n![表 1](figures/1t.png)";
    let problems = coverage_problems(misplaced, &plan);
    assert!(problems.iter().any(|p| p.contains("未出现在 how 节：Figure 1")));
    assert!(problems.iter().any(|p| p.contains("不在全局选图计划中：figures/1t.png")));
  }

  #[test]
  fn images_must_come_from_analyzed_manifest_once() {
    let item = |name: &str| FigureItem {
      name: name.into(),
      fig_type: "Figure".into(),
      page: 1,
      caption: String::new(),
      image: format!("figures/{name}.png"),
      region_boundary: Boundary { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 },
      caption_boundary: Boundary { x1: 0.0, y1: 0.0, x2: 1.0, y2: 1.0 },
    };
    let context = VisualContext {
      manifest: vec![item("1"), item("2")],
      analysis: json!({"items": [record("Figure 1", "how", "analyzed"), record("Figure 2", "how", "unreadable")]}),
      plan: json!({"items": []}),
    };
    let text = "![a](figures/1.png) ![b](figures/1.png) ![c](figures/2.png) ![d](figures/page-preview.png) ```\n![e](figures/x.png)\n```";
    let problems = image_problems(text, &context);
    assert!(problems.iter().any(|p| p == "重复插图：figures/1.png"));
    assert!(problems.iter().any(|p| p == "插图写作前未经预读：figures/2.png"));
    assert!(problems.iter().any(|p| p == "插图不在 pdffigures2 提取清单中：figures/page-preview.png"));
    assert!(!problems.iter().any(|p| p.contains("figures/x.png")));
  }
}

