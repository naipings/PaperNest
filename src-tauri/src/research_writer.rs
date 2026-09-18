use super::*;
use crate::research::{sources_block_for_writer, write_step, ResearchLlmSettings, ResearchSession};
use crate::research_dsh_log::DshRecorder;
use crate::research_llm::{
  adaptive_timeout_secs, estimate_text_tokens, research_llm_completion_streamed,
};
use crate::research_react::ReactFinish;

const WRITER_CHUNK_TOKENS: u32 = 6_000;
const WRITER_MAX_CHUNKS: u32 = 8;
const WRITER_SUMMARY_CHARS: usize = 8_000;

pub async fn write_research_report(
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  finish: &ReactFinish,
  dsh: &mut DshRecorder,
) -> Result<String> {
  let workspace = PathBuf::from(&session.workspace_path);
  let outline = fs::read_to_string(workspace.join("outline.md")).unwrap_or_default();
  let step_index = fs::read_dir(workspace.join("steps"))
    .map(|entries| entries.count())
    .unwrap_or(0)
    + 1;
  let turns = crate::research_turns::read_turns(&workspace)?;
  let current_turn = turns.last();
  let answer_rel = current_turn
    .map(|turn| turn.answer_path.clone())
    .unwrap_or_else(|| "report.md".into());

  let write_system = "你是学术文献调研写作助手（Writer）。根据大纲、研究备忘与来源撰写 Markdown 报告。每个事实性陈述标注 [src-xxx]；证据不足写「现有检索未覆盖」；禁止编造 DOI 与实验数字；按大纲充分展开各节，篇幅以用户「输出要求」为准；只输出 Markdown 正文。";
  let question_block = match current_turn.filter(|turn| turn.turn > 1) {
    Some(turn) => format!(
      "原始研究问题：{}\n本轮追问：{}\n只回答本轮追问，不要重复上一轮已写过的内容。",
      session.query, turn.question
    ),
    None => format!("研究问题：{}", session.query),
  };
  let summary = truncate_chars(&finish.summary, WRITER_SUMMARY_CHARS);
  let sources = sources_block_for_writer(&finish.sources);
  let base_user = format!(
    "{}\n输出要求：{}\n\n大纲：\n{}\n\n研究备忘：\n{}\n\n来源列表：\n{}\n",
    question_block,
    session.output_requirements,
    outline,
    summary,
    sources
  );

  // DSH 只记录首轮任务提示，避免把多段续写全文重复堆进轨迹。
  let turn = dsh.begin_session_turn(&base_user)?;
  dsh.request_header(write_system, &[], "initial")?;
  dsh.step_start(turn, 1)?;

  let target_tokens = settings.report_max_tokens.max(WRITER_CHUNK_TOKENS);
  let mut report = String::new();
  let mut produced = 0u32;
  let mut chunks = 0u32;

  while chunks < WRITER_MAX_CHUNKS && produced < target_tokens {
    crate::research::ensure_not_cancelled(&session.id).await?;
    let budget = (target_tokens - produced).min(WRITER_CHUNK_TOKENS);
    if budget < 400 {
      break;
    }
    let user = if chunks == 0 {
      format!(
        "{base_user}\n本段最多约 {budget} tokens。若篇幅不够可在自然段落处停下，后续会续写。"
      )
    } else {
      format!(
        "续写同一份 Markdown 调研报告。不要重复已有正文，从上一截断处自然接续；不要重写标题前言。\n\
         输出要求：{}\n大纲：\n{}\n\n【已写正文（尾部）】\n{}\n\n来源编号仍使用 [src-xxx]。本段最多约 {budget} tokens。",
        session.output_requirements,
        outline,
        truncate_tail(&report, 6_000)
      )
    };
    let timeout = adaptive_timeout_secs(budget, 180);
    let (piece, finish_reason) =
      research_llm_completion_streamed(settings, write_system, serde_json::json!(user), budget, timeout)
        .await?;
    let piece = piece.trim();
    if piece.is_empty() {
      break;
    }
    if !report.is_empty() {
      report.push('\n');
    }
    report.push_str(piece);
    let piece_tokens = estimate_text_tokens(piece);
    produced = produced.saturating_add(piece_tokens);
    chunks += 1;
    let hit_length = finish_reason.as_deref() == Some("length");
    // 模型主动收束，或本段明显短于预算且非 length 截断 → 结束。
    if !hit_length && piece_tokens < (budget * 6 / 10).max(400) {
      break;
    }
    if !hit_length && produced >= (target_tokens * 85 / 100).max(budget) {
      break;
    }
  }

  if report.trim().is_empty() {
    return Err("Writer 未生成任何正文".into());
  }

  dsh.assistant_message(turn, 1, Some(&report), &[])?;
  dsh.finish_step(turn, 1)?;
  dsh.turn_end_completed(turn)?;
  write_step(
    &workspace,
    step_index,
    "writer-report",
    &serde_json::json!({
      "role": "writer",
      "chars": report.len(),
      "chunks": chunks,
      "approxTokens": produced,
    }),
  )?;
  let answer_file = workspace.join(&answer_rel);
  if let Some(parent) = answer_file.parent() {
    fs::create_dir_all(parent).map_err(err)?;
  }
  fs::write(answer_file, &report).map_err(err)?;
  Ok(report)
}

fn truncate_chars(text: &str, max_chars: usize) -> String {
  if text.chars().count() <= max_chars {
    return text.to_string();
  }
  let head: String = text.chars().take(max_chars).collect();
  format!("{head}\n…(备忘已截断)")
}

fn truncate_tail(text: &str, max_chars: usize) -> String {
  let count = text.chars().count();
  if count <= max_chars {
    return text.to_string();
  }
  let skip = count - max_chars;
  let tail: String = text.chars().skip(skip).collect();
  format!("…(前文省略)\n{tail}")
}
