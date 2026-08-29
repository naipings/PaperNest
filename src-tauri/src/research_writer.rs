use super::*;
use crate::research::{sources_block, write_step, ResearchLlmSettings, ResearchSession};
use crate::research_dsh_log::DshRecorder;
use crate::research_llm::research_llm_completion;
use crate::research_react::ReactFinish;

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

  let write_system = "你是学术文献调研写作助手（Writer）。根据大纲、研究备忘与来源撰写 Markdown 报告。每个事实性陈述标注 [src-001]；证据不足写「现有检索未覆盖」；禁止编造 DOI 与实验数字；只输出 Markdown 正文。";
  let question_block = match current_turn.filter(|turn| turn.turn > 1) {
    Some(turn) => format!(
      "原始研究问题：{}\n本轮追问：{}\n只回答本轮追问，不要重复上一轮已写过的内容。",
      session.query, turn.question
    ),
    None => format!("研究问题：{}", session.query),
  };
  let write_user = format!(
    "{}\n输出要求：{}\n\n大纲：\n{}\n\n研究备忘：\n{}\n\n来源列表：\n{}\n",
    question_block,
    session.output_requirements,
    outline,
    finish.summary,
    sources_block(&finish.sources)
  );
  let turn = dsh.begin_session_turn(&write_user)?;
  dsh.request_header(write_system, &[], "initial")?;
  dsh.step_start(turn, 1)?;
  let report = research_llm_completion(
    settings,
    write_system,
    serde_json::json!(write_user),
    Some(settings.max_tokens_per_step.max(2000)),
    180,
  )
  .await?;
  dsh.assistant_message(turn, 1, Some(&report), &[])?;
  dsh.finish_step(turn, 1)?;
  dsh.turn_end_completed(turn)?;
  write_step(
    &workspace,
    step_index,
    "writer-report",
    &serde_json::json!({ "role": "writer", "chars": report.len() }),
  )?;
  let answer_file = workspace.join(&answer_rel);
  if let Some(parent) = answer_file.parent() {
    fs::create_dir_all(parent).map_err(err)?;
  }
  fs::write(answer_file, &report).map_err(err)?;
  Ok(report)
}
