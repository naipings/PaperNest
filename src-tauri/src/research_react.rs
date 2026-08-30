use super::*;
use crate::research::{ensure_not_cancelled, write_step, ResearchLlmSettings, ResearchSession, ResearchSource};
use crate::research_dsh_compact;
use crate::research_dsh_log::{DshRecorder, UserMessageKind};
use crate::research_dsh_store;
use crate::research_llm::{parse_json_react_calls, research_llm_with_tools, LlmToolCall};
use crate::research_subagent::run_subtopics;
use crate::research_tools::{
  execute_react_tool, pipeline_invoke, react_tool_catalog, SourceCollector, ToolContext, ToolOutcome,
};

#[derive(Clone, Debug)]
pub struct ReactFinish {
  pub summary: String,
  pub sources: Vec<ResearchSource>,
}

pub fn effective_react_limits(settings: &ResearchLlmSettings) -> (u32, u32) {
  if settings.max_react_rounds > 0 || settings.max_tool_calls > 0 {
    let rounds = if settings.max_react_rounds > 0 {
      settings.max_react_rounds
    } else {
      20
    };
    let tools = if settings.max_tool_calls > 0 {
      settings.max_tool_calls
    } else {
      40
    };
    return (rounds, tools);
  }
  match settings.research_depth.as_str() {
    "quick" => (8, 15),
    "deep" => (35, 80),
    _ => (20, 40),
  }
}

#[derive(Clone, Debug)]
pub struct ReactResumeState {
  pub messages: Vec<serde_json::Value>,
  pub react_turn: u32,
  pub start_round: u32,
  pub tool_calls_used: u32,
}

pub async fn run_react_loop(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  dsh: &mut DshRecorder,
) -> Result<ReactFinish> {
  run_react_loop_inner(library_pool, settings, session, dsh, None).await
}

pub async fn run_react_loop_resume(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  dsh: &mut DshRecorder,
  resume: ReactResumeState,
) -> Result<ReactFinish> {
  run_react_loop_inner(library_pool, settings, session, dsh, Some(resume)).await
}

async fn run_react_loop_inner(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  dsh: &mut DshRecorder,
  resume: Option<ReactResumeState>,
) -> Result<ReactFinish> {
  let workspace = PathBuf::from(&session.workspace_path);
  let now = Utc::now().to_rfc3339();
  let mut step_index = read_steps_count(&workspace)? + 1;
  let mut collector = SourceCollector::from_workspace(&workspace)?;
  let tools = react_tool_catalog(settings);
  let (max_rounds, max_tool_calls) = effective_react_limits(settings);
  let (mut messages, react_turn, start_round, mut tool_calls_used, resuming) = match resume {
    Some(state) => (
      state.messages,
      state.react_turn,
      state.start_round,
      state.tool_calls_used,
      true,
    ),
    None => (
      vec![
        serde_json::json!({"role": "system", "content": react_system_prompt()}),
        react_user_message(session, &workspace)?,
      ],
      1u32,
      1u32,
      0u32,
      false,
    ),
  };
  // 首轮与追问轮的最后一条消息就是用户提问，无需再补「继续检索」的提示；
  // 从工具结果中途续跑时才需要。
  let first_round_carries_user = messages
    .last()
    .and_then(|message| message.get("role"))
    .and_then(|role| role.as_str())
    == Some("user");

  let mut finish_summary = String::new();

  for round in start_round..=max_rounds {
    ensure_not_cancelled(&session.id).await?;
    let system_prompt = react_system_prompt();
    let snapshot = research_dsh_store::load_snapshot(&workspace)?;
    if research_dsh_compact::maybe_compact_if_needed(settings, dsh, &snapshot.events, react_turn, &workspace).await? {
      messages = crate::research_dsh_derive::derive_openai_messages(
        &research_dsh_store::load_snapshot(&workspace)?.events,
      );
    }
    if round == start_round && first_round_carries_user {
      dsh.request_header(system_prompt, &tools, if resuming { "change" } else { "initial" })?;
    } else {
      dsh.user_message(
        "请调用工具继续检索，或调用 finish_research 结束调研。",
        UserMessageKind::Inject {
          plugin: "papernest-react",
          summary: "ReAct 续轮",
        },
      )?;
      dsh.request_header(system_prompt, &tools, "change")?;
    }
    dsh.step_start(react_turn, round)?;

    let mut response = research_llm_with_tools(settings, &messages, &tools, Some(2000), 120).await?;

    if response.tool_calls.is_empty() {
      if let Some(content) = &response.content {
        response.tool_calls = parse_json_react_calls(content);
      }
    }

    dsh.assistant_message(
      react_turn,
      round,
      response.content.as_deref(),
      &response.tool_calls,
    )?;

    write_step(
      &workspace,
      step_index,
      "react-llm",
      &serde_json::json!({
        "round": round,
        "content": response.content,
        "toolCalls": response.tool_calls.iter().map(|c| &c.name).collect::<Vec<_>>(),
      }),
    )?;
    step_index += 1;

    if response.tool_calls.is_empty() {
      dsh.finish_step(react_turn, round)?;
      if let Some(text) = response.content.filter(|t| !t.trim().is_empty()) {
        if try_parse_finish_from_text(&text).is_some() {
          finish_summary = text;
          break;
        }
      }
      messages.push(serde_json::json!({
        "role": "user",
        "content": "请调用工具继续检索，或调用 finish_research 结束调研。若无法 function calling，输出 JSON：{\"action\":\"tool\",\"name\":\"...\",\"args\":{...}} 或 {\"action\":\"finish\",\"summary\":\"...\"}"
      }));
      continue;
    }

    messages.push(assistant_tool_message(&response.tool_calls, response.content.as_deref()));

    for call in response.tool_calls {
      dsh.tool_call(react_turn, round, &call)?;
      tool_calls_used += 1;
      if tool_calls_used > max_tool_calls {
        finish_summary = "已达 tool 调用上限，进入写作阶段。".into();
        dsh.finish_step(react_turn, round)?;
        break;
      }
      let mut ctx = ToolContext {
        library_pool,
        workspace: &workspace,
        allow_web: settings.allow_web_search,
        research_settings: Some(settings),
        collector: &mut collector,
        now: &now,
        allow_subtopic: true,
      };
      let outcome = execute_react_tool(&mut ctx, &call.name, &call.arguments).await?;
      if handle_tool_outcome(
        library_pool,
        settings,
        session,
        &workspace,
        &mut collector,
        &now,
        &mut step_index,
        round,
        react_turn,
        dsh,
        &call,
        outcome,
        &mut messages,
        &mut finish_summary,
      )
      .await?
      {
        dsh.finish_step(react_turn, round)?;
        break;
      }
    }
    if finish_summary.is_empty() {
      dsh.finish_step(react_turn, round)?;
    }
    if !finish_summary.is_empty() {
      break;
    }
  }

  if finish_summary.is_empty() {
    finish_summary = format!(
      "已完成 {max_rounds} 轮检索，共 {} 条来源。",
      collector.sources().len()
    );
  }

  dsh.turn_end_completed(react_turn)?;

  Ok(ReactFinish {
    summary: finish_summary,
    sources: collector.into_sources(),
  })
}

pub async fn run_supplementary_react(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  queries: &[String],
  sources: &mut Vec<ResearchSource>,
  step_index: &mut usize,
  dsh: &mut DshRecorder,
  turn: u32,
) -> Result<String> {
  let workspace = PathBuf::from(&session.workspace_path);
  let now = Utc::now().to_rfc3339();
  let mut collector = SourceCollector::from_workspace(&workspace)?;
  let mut step = 1u32;
  for query in queries {
    let call = LlmToolCall {
      id: format!("review-t{turn}-search-{step}"),
      name: "search_library".into(),
      arguments: serde_json::json!({ "query": query }),
    };
    dsh.step_start(turn, step)?;
    dsh.tool_call(turn, step, &call)?;
    let outcome = pipeline_invoke(
      library_pool,
      &workspace,
      settings,
      &mut collector,
      &now,
      "search_library",
      serde_json::json!({ "query": query }),
    )
    .await?;
    let observation = match &outcome {
      ToolOutcome::Continue { observation, .. } => observation.as_str(),
      _ => "",
    };
    dsh.tool_result(turn, step, &call.id, observation, false)?;
    write_step(
      &workspace,
      *step_index,
      "reviewer-tool-search_library",
      &serde_json::json!({ "query": query, "observation": observation }),
    )?;
    *step_index += 1;
    dsh.finish_step(turn, step)?;
    step += 1;
    if settings.allow_web_search {
      let arxiv_call = LlmToolCall {
        id: format!("review-t{turn}-arxiv-{step}"),
        name: "search_arxiv".into(),
        arguments: serde_json::json!({ "query": query }),
      };
      dsh.step_start(turn, step)?;
      dsh.tool_call(turn, step, &arxiv_call)?;
      let arxiv = pipeline_invoke(
        library_pool,
        &workspace,
        settings,
        &mut collector,
        &now,
        "search_arxiv",
        serde_json::json!({ "query": query }),
      )
      .await?;
      let arxiv_obs = match &arxiv {
        ToolOutcome::Continue { observation, .. } => observation.as_str(),
        _ => "",
      };
      dsh.tool_result(turn, step, &arxiv_call.id, arxiv_obs, false)?;
      write_step(
        &workspace,
        *step_index,
        "reviewer-tool-search_arxiv",
        &serde_json::json!({ "query": query, "observation": arxiv_obs }),
      )?;
      *step_index += 1;
      dsh.finish_step(turn, step)?;
      step += 1;
      tokio::time::sleep(Duration::from_millis(1100)).await;
    }
  }
  *sources = collector.into_sources();
  Ok(format!("审稿补检索完成，当前共 {} 条来源。", sources.len()))
}

async fn handle_tool_outcome(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
  workspace: &Path,
  collector: &mut SourceCollector,
  _now: &str,
  step_index: &mut usize,
  round: u32,
  turn: u32,
  dsh: &mut DshRecorder,
  call: &LlmToolCall,
  outcome: ToolOutcome,
  messages: &mut Vec<serde_json::Value>,
  finish_summary: &mut String,
) -> Result<bool> {
  match outcome {
    ToolOutcome::Finished { summary } => {
      dsh.tool_result(turn, round, &call.id, &summary, false)?;
      write_step(
        workspace,
        *step_index,
        "react-finish",
        &serde_json::json!({ "summary": summary, "round": round }),
      )?;
      *finish_summary = summary;
      Ok(true)
    }
    ToolOutcome::Subtopics { questions } => {
      let observation = run_subtopics(
        library_pool,
        settings,
        session,
        workspace,
        collector,
        step_index,
        dsh,
        turn,
        round,
        &questions,
      )
      .await?;
      dsh.tool_result(turn, round, &call.id, &observation, false)?;
      write_step(
        workspace,
        *step_index,
        "react-tool-research_subtopic",
        &serde_json::json!({ "round": round, "subtopics": questions, "observation": observation }),
      )?;
      *step_index += 1;
      messages.push(serde_json::json!({
        "role": "tool",
        "tool_call_id": call.id,
        "content": observation
      }));
      Ok(false)
    }
    ToolOutcome::Continue {
      observation,
      new_source_ids,
    } => {
      dsh.tool_result(turn, round, &call.id, &observation, false)?;
      write_step(
        workspace,
        *step_index,
        &format!("react-tool-{}", call.name),
        &serde_json::json!({
          "round": round,
          "tool": call.name,
          "args": call.arguments,
          "observation": observation,
          "newSourceIds": new_source_ids,
        }),
      )?;
      *step_index += 1;
      messages.push(serde_json::json!({
        "role": "tool",
        "tool_call_id": call.id,
        "content": observation
      }));
      if call.name == "search_arxiv" || call.name == "llm_web_search" {
        tokio::time::sleep(Duration::from_millis(3500)).await;
      }
      Ok(false)
    }
  }
}

pub(crate) fn react_system_prompt() -> &'static str {
  "你是 PaperNest 文献调研 Agent。通过工具检索本地论文库与用户笔记，必要时检索 arXiv 与外网学术来源（OpenAlex/Crossref/GitHub，不下载 PDF）。\n\
   规则：\n\
   1. 先 search_library（用 1～3 个短关键词，如「冷启动」「推荐系统」，不要整句长查询）\n\
   2. 本地不足时用 search_arxiv / search_web：查询词用 2～5 个英文主题词并按重要度排序（如 cold start recommendation），\
   所有词按 AND 组合；调研「最新进展」时给 search_web 传 fromYear\n\
   3. 博客、新闻、技术综述、行业动态等通用网页用 llm_web_search（若已注册）；学术元数据仍用 search_web / search_arxiv\n\
   4. get_paper 的 paperId 来自 search_library 行内 paper: 后的 ID，或传入已登记的 [src-xxx]（本地与外网来源均可）；\
   同一篇论文只取一次，重复调用不会返回新信息\n\
   5. 用户消息里给出链接时用 fetch_url 读取正文\n\
   6. 可用 research_subtopic 委派 1～2 个子问题（子 Agent 可侧重 llm_web_search 做联网综述）；可用 update_outline 维护章节骨架\n\
   7. 证据足够后必须调用 finish_research(summary=给 Writer 的备忘)\n\
   8. 引用只使用工具返回的 [src-xxx] 编号，没有来源支撑的结论不要写\n\
   若无法 function calling，只输出 JSON：{\"action\":\"tool\",\"name\":\"工具名\",\"args\":{...}} 或 {\"action\":\"finish\",\"summary\":\"...\"}"
}

fn react_user_prompt(session: &ResearchSession) -> String {
  format!(
    "研究问题：{}\n输出要求：{}\n请开始调研。",
    session.query,
    if session.output_requirements.trim().is_empty() {
      "中文综述，含引用标注 [src-xxx]".to_string()
    } else {
      session.output_requirements.clone()
    }
  )
}

fn react_user_message(session: &ResearchSession, workspace: &Path) -> Result<serde_json::Value> {
  let attachments = crate::research_turns::read_turns(workspace)?
    .first()
    .map(|turn| turn.attachments.clone())
    .unwrap_or_default();
  let text = format!(
    "{}{}",
    react_user_prompt(session),
    crate::research_turns::attachment_text_block(workspace, &attachments)
  );
  let images = crate::research_turns::attachment_image_blocks(workspace, &attachments)?;
  Ok(crate::research_turns::user_message_value(text, images))
}

fn assistant_tool_message(calls: &[LlmToolCall], content: Option<&str>) -> serde_json::Value {
  serde_json::json!({
    "role": "assistant",
    "content": content.unwrap_or(""),
    "tool_calls": calls.iter().map(|call| serde_json::json!({
      "id": call.id,
      "type": "function",
      "function": {
        "name": call.name,
        "arguments": call.arguments.to_string()
      }
    })).collect::<Vec<_>>()
  })
}

fn try_parse_finish_from_text(text: &str) -> Option<String> {
  let calls = parse_json_react_calls(text);
  if let Some(call) = calls.first() {
    if call.name == "finish_research" {
      return call
        .arguments
        .get("summary")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    }
  }
  None
}

fn read_steps_count(workspace: &Path) -> Result<usize> {
  let steps_dir = workspace.join("steps");
  if !steps_dir.is_dir() {
    return Ok(0);
  }
  Ok(fs::read_dir(steps_dir).map_err(err)?.count())
}
