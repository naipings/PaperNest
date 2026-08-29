use super::*;
use crate::research::{sources_block, write_step, ResearchLlmSettings, ResearchSession, ResearchSource};
use crate::research_dsh_log::DshRecorder;
use crate::research_llm::research_llm_completion;
use crate::research_react::{run_supplementary_react, ReactFinish};

#[derive(Clone, Debug)]
struct ReviewResult {
  accept: bool,
  follow_up_queries: Vec<String>,
  notes: String,
}

pub async fn apply_reviewer_gate(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  finish: &mut ReactFinish,
  dsh: &mut DshRecorder,
) -> Result<()> {
  let workspace = PathBuf::from(&session.workspace_path);
  let outline = fs::read_to_string(workspace.join("outline.md")).unwrap_or_default();
  let mut step_index = read_steps_count(&workspace)? + 1;

  for revision in 0..2 {
    crate::research::ensure_not_cancelled(&session.id).await?;
    let review = review_once(settings, session, &outline, &finish.summary, &finish.sources, dsh).await?;
    write_step(
      &workspace,
      step_index,
      "reviewer",
      &serde_json::json!({
        "revision": revision + 1,
        "accept": review.accept,
        "followUpQueries": review.follow_up_queries,
        "notes": review.notes,
      }),
    )?;
    step_index += 1;

    if review.accept || review.follow_up_queries.is_empty() {
      if !review.notes.is_empty() {
        finish.summary = format!("{}\n\n审稿备忘：{}", finish.summary, review.notes);
      }
      break;
    }

    let review_turn = dsh.begin_session_turn(&format!(
      "审稿补检索：{}",
      review.follow_up_queries.join("；")
    ))?;
    let extra = run_supplementary_react(
      library_pool,
      settings,
      session,
      &review.follow_up_queries,
      &mut finish.sources,
      &mut step_index,
      dsh,
      review_turn,
    )
    .await?;
    dsh.turn_end_completed(review_turn)?;
    finish.summary = format!("{}\n\n补检索备忘：{}", finish.summary, extra);
  }
  Ok(())
}

async fn review_once(
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  outline: &str,
  summary: &str,
  sources: &[ResearchSource],
  dsh: &mut DshRecorder,
) -> Result<ReviewResult> {
  let system = "你是文献调研审稿人（Reviewer）。根据问题、大纲、研究备忘与来源，输出 JSON：{\"accept\":true/false,\"gaps\":[\"缺口\"],\"follow_up_queries\":[\"补充检索词\"],\"notes\":\"备忘\"}。accept=true 表示可以写作；false 时 follow_up_queries 1～2 条。只输出 JSON。";
  let user = format!(
    "研究问题：{}\n大纲：\n{}\n\n研究备忘：\n{}\n\n来源：\n{}\n",
    session.query,
    outline,
    summary,
    sources_block(sources)
  );
  let turn = dsh.begin_session_turn(&user)?;
  dsh.request_header(system, &[], "initial")?;
  dsh.step_start(turn, 1)?;
  let raw = research_llm_completion(settings, system, serde_json::json!(user), Some(800), 90).await?;
  dsh.assistant_message(turn, 1, Some(&raw), &[])?;
  dsh.finish_step(turn, 1)?;
  dsh.turn_end_completed(turn)?;
  let json = json_from_llm(&raw).unwrap_or_else(|_| serde_json::json!({}));
  let accept = json.get("accept").and_then(|v| v.as_bool()).unwrap_or(sources.len() >= 3);
  let follow_ups: Vec<String> = json
    .get("follow_up_queries")
    .and_then(|v| v.as_array())
    .map(|items| {
      items
        .iter()
        .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
        .take(2)
        .collect()
    })
    .unwrap_or_default();
  let notes = json
    .get("notes")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .trim()
    .to_string();
  Ok(ReviewResult {
    accept,
    follow_up_queries: follow_ups,
    notes,
  })
}

fn read_steps_count(workspace: &Path) -> Result<usize> {
  let steps_dir = workspace.join("steps");
  if !steps_dir.is_dir() {
    return Ok(0);
  }
  Ok(fs::read_dir(steps_dir).map_err(err)?.count())
}
