use super::*;
use crate::research::{sources_block, write_step, ResearchLlmSettings, ResearchSession};
use crate::research_llm::research_llm_completion;
use crate::research_react::ReactFinish;

pub async fn write_research_report(
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  finish: &ReactFinish,
) -> Result<String> {
  let workspace = PathBuf::from(&session.workspace_path);
  let outline = fs::read_to_string(workspace.join("outline.md")).unwrap_or_default();
  let step_index = fs::read_dir(workspace.join("steps"))
    .map(|entries| entries.count())
    .unwrap_or(0)
    + 1;

  let write_system = "你是学术文献调研写作助手（Writer）。根据大纲、研究备忘与来源撰写 Markdown 报告。每个事实性陈述标注 [src-001]；证据不足写「现有检索未覆盖」；禁止编造 DOI 与实验数字；只输出 Markdown 正文。";
  let write_user = format!(
    "研究问题：{}\n输出要求：{}\n\n大纲：\n{}\n\n研究备忘：\n{}\n\n来源列表：\n{}\n",
    session.query,
    session.output_requirements,
    outline,
    finish.summary,
    sources_block(&finish.sources)
  );
  let report = research_llm_completion(
    settings,
    write_system,
    serde_json::json!(write_user),
    Some(settings.max_tokens_per_step.max(2000)),
    180,
  )
  .await?;
  write_step(
    &workspace,
    step_index,
    "writer-report",
    &serde_json::json!({ "role": "writer", "chars": report.len() }),
  )?;
  fs::write(workspace.join("report.md"), &report).map_err(err)?;
  Ok(report)
}
