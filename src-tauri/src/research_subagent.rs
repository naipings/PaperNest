use super::*;
use crate::research::{write_step, ResearchLlmSettings, ResearchSession, ResearchSource};
use crate::research_dsh_log::{DshRecorder, UserMessageKind};
use crate::research_dsh_store;
use crate::research_llm::{research_llm_with_tools, LlmToolCall};
use crate::research_tools::{
  execute_react_tool, react_tool_catalog, SourceCollector, ToolContext, ToolOutcome,
};

const MAX_SUBTOPICS: usize = 2;
const SUBAGENT_MAX_ROUNDS: u32 = 6;
const SUBAGENT_MAX_TOOLS: u32 = 12;
const SUBAGENT_PROVIDER: &str = "subagent-fork-in-process";

fn compress_subagent_brief(question: &str, sources: &[ResearchSource]) -> String {
  if sources.is_empty() {
    return format!("子题「{question}」未检索到新来源。");
  }
  let mut lines = vec![format!("子题「{question}」摘要（{} 条新来源）：", sources.len())];
  for source in sources.iter().take(12) {
    lines.push(format!(
      "- [{}] {}: {}",
      source.id,
      source.title,
      source.excerpt.chars().take(150).collect::<String>()
    ));
  }
  lines.join("\n")
}

pub async fn run_subtopics(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  workspace: &Path,
  collector: &mut SourceCollector,
  step_index: &mut usize,
  parent_dsh: &mut DshRecorder,
  parent_turn: u32,
  parent_step: u32,
  subtopics: &[String],
) -> Result<String> {
  let questions: Vec<String> = subtopics
    .iter()
    .map(|s| s.trim().to_string())
    .filter(|s| !s.is_empty())
    .take(MAX_SUBTOPICS)
    .collect();
  if questions.is_empty() {
    return Err("research_subtopic 需要 1～2 个非空子问题".into());
  }
  if questions.len() > MAX_SUBTOPICS {
    return Err(format!("research_subtopic 最多 {MAX_SUBTOPICS} 个子问题"));
  }

  let parent_snapshot = research_dsh_store::load_snapshot(workspace)?;
  let seed = research_dsh_store::completed_turn_prefix(&parent_snapshot.events);
  let now = Utc::now().to_rfc3339();
  let mut summaries = Vec::new();
  for (idx, question) in questions.iter().enumerate() {
    let child_id = Uuid::new_v4().to_string();
    let label = format!("子题{}：{question}", idx + 1);
    research_dsh_store::init_child_session_log(
      workspace,
      &child_id,
      &parent_snapshot.header,
      &seed,
      &label,
    )?;
    parent_dsh.user_message(
      &format!("委派子 Agent（fork）· {child_id} · {question}"),
      UserMessageKind::Inject {
        plugin: SUBAGENT_PROVIDER,
        summary: &label,
      },
    )?;
    let summary = run_one_subagent(
      library_pool,
      settings,
      session,
      workspace,
      collector,
      step_index,
      &child_id,
      &now,
      idx + 1,
      question,
    )
    .await?;
    write_step(
      workspace,
      *step_index,
      "subagent-fork-complete",
      &serde_json::json!({
        "childSessionId": child_id,
        "question": question,
        "summary": summary,
        "provider": SUBAGENT_PROVIDER,
        "parentTurn": parent_turn,
        "parentStep": parent_step,
      }),
    )?;
    *step_index += 1;
    summaries.push(format!("{label}\n{summary}"));
  }
  Ok(summaries.join("\n\n"))
}

async fn run_one_subagent(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  workspace: &Path,
  collector: &mut SourceCollector,
  step_index: &mut usize,
  child_id: &str,
  now: &str,
  index: usize,
  question: &str,
) -> Result<String> {
  let tools: Vec<_> = react_tool_catalog(settings)
    .into_iter()
    .filter(|t| t.name != "research_subtopic")
    .collect();
  let system_prompt = subagent_system_prompt();
  let user_prompt = format!("主问题：{}\n子问题：{question}\n请检索并 finish_research。", session.query);
  let mut child_dsh = DshRecorder::open_child(workspace, child_id, "openai-compatible", &settings.model)?;
  let child_turn = child_dsh.begin_session_turn(&user_prompt)?;
  let mut messages = vec![
    serde_json::json!({"role": "system", "content": system_prompt}),
    serde_json::json!({"role": "user", "content": user_prompt}),
  ];
  let mut tool_used = 0u32;
  let mut summary = String::new();
  let sources_before = collector.sources().len();

  for round in 1..=SUBAGENT_MAX_ROUNDS {
    if round == 1 {
      child_dsh.request_header(system_prompt, &tools, "initial")?;
    } else {
      child_dsh.user_message(
        "请调用工具或 finish_research。",
        UserMessageKind::Inject {
          plugin: "papernest-subagent",
          summary: "子 Agent 续轮",
        },
      )?;
      child_dsh.request_header(system_prompt, &tools, "change")?;
    }
    child_dsh.step_start(child_turn, round)?;
    let response = research_llm_with_tools(settings, &messages, &tools, Some(900), 90).await?;
    child_dsh.assistant_message(child_turn, round, response.content.as_deref(), &response.tool_calls)?;

    write_step(
      workspace,
      *step_index,
      &format!("subagent-{index}-react-llm"),
      &serde_json::json!({
        "childSessionId": child_id,
        "round": round,
        "question": question,
        "toolCalls": response.tool_calls.iter().map(|c| &c.name).collect::<Vec<_>>()
      }),
    )?;
    *step_index += 1;

    if response.tool_calls.is_empty() {
      let parsed = crate::research_llm::parse_json_react_calls(response.content.as_deref().unwrap_or(""));
      if !parsed.is_empty() {
        messages.push(serde_json::json!({"role": "assistant", "content": response.content.clone().unwrap_or_default()}));
        for call in parsed {
          child_dsh.tool_call(child_turn, round, &call)?;
          tool_used += 1;
          if tool_used > SUBAGENT_MAX_TOOLS {
            summary = compress_subagent_brief(question, &collector.sources()[sources_before..]);
            child_dsh.finish_step(child_turn, round)?;
            child_dsh.turn_end_completed(child_turn)?;
            return Ok(summary);
          }
          if handle_subagent_call(
            library_pool,
            settings,
            workspace,
            collector,
            now,
            step_index,
            index,
            round,
            child_turn,
            round,
            &mut child_dsh,
            &call,
            &mut messages,
            &mut summary,
          )
          .await?
          {
            child_dsh.finish_step(child_turn, round)?;
            child_dsh.turn_end_completed(child_turn)?;
            return Ok(summary);
          }
        }
        child_dsh.finish_step(child_turn, round)?;
        continue;
      }
      messages.push(serde_json::json!({"role": "user", "content": "请调用工具或 finish_research。"}));
      child_dsh.finish_step(child_turn, round)?;
      continue;
    }

    messages.push(subagent_assistant_message(&response.tool_calls, response.content.as_deref()));
    for call in response.tool_calls {
      child_dsh.tool_call(child_turn, round, &call)?;
      tool_used += 1;
      if tool_used > SUBAGENT_MAX_TOOLS {
        summary = compress_subagent_brief(question, &collector.sources()[sources_before..]);
        child_dsh.finish_step(child_turn, round)?;
        child_dsh.turn_end_completed(child_turn)?;
        return Ok(summary);
      }
      if handle_subagent_call(
        library_pool,
        settings,
        workspace,
        collector,
        now,
        step_index,
        index,
        round,
        child_turn,
        round,
        &mut child_dsh,
        &call,
        &mut messages,
        &mut summary,
      )
      .await?
      {
        child_dsh.finish_step(child_turn, round)?;
        child_dsh.turn_end_completed(child_turn)?;
        return Ok(summary);
      }
    }
    child_dsh.finish_step(child_turn, round)?;
    if !summary.is_empty() {
      child_dsh.turn_end_completed(child_turn)?;
      return Ok(summary);
    }
  }
  if summary.is_empty() {
    summary = compress_subagent_brief(question, &collector.sources()[sources_before..]);
  }
  child_dsh.turn_end_completed(child_turn)?;
  Ok(summary)
}

async fn handle_subagent_call(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  workspace: &Path,
  collector: &mut SourceCollector,
  now: &str,
  step_index: &mut usize,
  sub_index: usize,
  round: u32,
  turn: u32,
  step: u32,
  dsh: &mut DshRecorder,
  call: &LlmToolCall,
  messages: &mut Vec<serde_json::Value>,
  summary: &mut String,
) -> Result<bool> {
  let mut ctx = ToolContext {
    library_pool,
    workspace,
    allow_web: settings.allow_web_search,
    research_settings: Some(settings),
    collector,
    now,
    allow_subtopic: false,
  };
  let outcome = execute_react_tool(&mut ctx, &call.name, &call.arguments).await?;
  match outcome {
    ToolOutcome::Finished { summary: text } => {
      dsh.tool_result(turn, step, &call.id, &text, false)?;
      write_step(
        workspace,
        *step_index,
        &format!("subagent-{sub_index}-finish"),
        &serde_json::json!({ "round": round, "summary": text }),
      )?;
      *step_index += 1;
      *summary = text;
      Ok(true)
    }
    ToolOutcome::Continue {
      observation,
      new_source_ids,
    } => {
      dsh.tool_result(turn, step, &call.id, &observation, false)?;
      write_step(
        workspace,
        *step_index,
        &format!("subagent-{sub_index}-tool-{}", call.name),
        &serde_json::json!({ "round": round, "tool": call.name, "newSourceIds": new_source_ids, "observation": observation }),
      )?;
      *step_index += 1;
      messages.push(serde_json::json!({"role": "tool", "tool_call_id": call.id, "content": observation}));
      if call.name == "search_arxiv" || call.name == "llm_web_search" {
        tokio::time::sleep(Duration::from_millis(1100)).await;
      }
      Ok(false)
    }
    ToolOutcome::Subtopics { .. } => Err("子 Agent 不可嵌套 research_subtopic".into()),
  }
}

fn subagent_system_prompt() -> &'static str {
  "你是文献调研子 Agent（fork 自父会话已完成 turn 前缀）。针对给定子问题检索本地库、arXiv/OpenAlex 学术元数据；\
   博客/新闻/行业综述类子问题优先 llm_web_search（若已注册），再 finish_research。不要调用 research_subtopic。"
}

fn subagent_assistant_message(calls: &[LlmToolCall], content: Option<&str>) -> serde_json::Value {
  serde_json::json!({
    "role": "assistant",
    "content": content.unwrap_or(""),
    "tool_calls": calls.iter().map(|call| serde_json::json!({
      "id": call.id,
      "type": "function",
      "function": { "name": call.name, "arguments": call.arguments.to_string() }
    })).collect::<Vec<_>>()
  })
}
