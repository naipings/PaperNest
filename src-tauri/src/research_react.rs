use super::*;
use crate::research::{write_step, ResearchLlmSettings, ResearchSession, ResearchSource};
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

pub async fn run_react_loop(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
) -> Result<ReactFinish> {
  let workspace = PathBuf::from(&session.workspace_path);
  let now = Utc::now().to_rfc3339();
  let mut step_index = read_steps_count(&workspace)? + 1;
  let mut collector = SourceCollector::from_workspace(&workspace)?;
  let tools = react_tool_catalog(settings.allow_web_search);
  let (max_rounds, max_tool_calls) = effective_react_limits(settings);
  let mut tool_calls_used = 0u32;
  let mut messages: Vec<serde_json::Value> = vec![
    serde_json::json!({"role": "system", "content": react_system_prompt()}),
    serde_json::json!({"role": "user", "content": react_user_prompt(session)}),
  ];

  let mut finish_summary = String::new();

  for round in 1..=max_rounds {
    let mut response = research_llm_with_tools(settings, &messages, &tools, Some(1200), 120).await?;

    if response.tool_calls.is_empty() {
      if let Some(content) = &response.content {
        response.tool_calls = parse_json_react_calls(content);
      }
    }

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
      tool_calls_used += 1;
      if tool_calls_used > max_tool_calls {
        finish_summary = "已达 tool 调用上限，进入写作阶段。".into();
        break;
      }
      let mut ctx = ToolContext {
        library_pool,
        workspace: &workspace,
        allow_web: settings.allow_web_search,
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
        &call,
        outcome,
        &mut messages,
        &mut finish_summary,
      )
      .await?
      {
        break;
      }
      if !finish_summary.is_empty() {
        break;
      }
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
) -> Result<String> {
  let workspace = PathBuf::from(&session.workspace_path);
  let now = Utc::now().to_rfc3339();
  let mut collector = SourceCollector::from_workspace(&workspace)?;
  for query in queries {
    let outcome = pipeline_invoke(
      library_pool,
      &workspace,
      settings.allow_web_search,
      &mut collector,
      &now,
      "search_library",
      serde_json::json!({ "query": query }),
    )
    .await?;
    write_step(
      &workspace,
      *step_index,
      "reviewer-tool-search_library",
      &serde_json::json!({ "query": query, "observation": match &outcome { ToolOutcome::Continue { observation, .. } => observation, _ => "" } }),
    )?;
    *step_index += 1;
    if settings.allow_web_search {
      let arxiv = pipeline_invoke(
        library_pool,
        &workspace,
        true,
        &mut collector,
        &now,
        "search_arxiv",
        serde_json::json!({ "query": query }),
      )
      .await?;
      write_step(
        &workspace,
        *step_index,
        "reviewer-tool-search_arxiv",
        &serde_json::json!({ "query": query, "observation": match &arxiv { ToolOutcome::Continue { observation, .. } => observation, _ => "" } }),
      )?;
      *step_index += 1;
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
  call: &LlmToolCall,
  outcome: ToolOutcome,
  messages: &mut Vec<serde_json::Value>,
  finish_summary: &mut String,
) -> Result<bool> {
  match outcome {
    ToolOutcome::Finished { summary } => {
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
        &questions,
      )
      .await?;
      write_step(
        workspace,
        *step_index,
        "react-tool-research_subtopic",
        &serde_json::json!({ "round": round, "subtopics": questions, "observation": observation.chars().take(500).collect::<String>() }),
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
      write_step(
        workspace,
        *step_index,
        &format!("react-tool-{}", call.name),
        &serde_json::json!({
          "round": round,
          "tool": call.name,
          "args": call.arguments,
          "observation": observation.chars().take(800).collect::<String>(),
          "newSourceIds": new_source_ids,
        }),
      )?;
      *step_index += 1;
      messages.push(serde_json::json!({
        "role": "tool",
        "tool_call_id": call.id,
        "content": observation
      }));
      if call.name == "search_arxiv" {
        tokio::time::sleep(Duration::from_millis(1100)).await;
      }
      Ok(false)
    }
  }
}

fn react_system_prompt() -> &'static str {
  "你是 PaperNest 文献调研 Agent。通过工具检索本地论文库与用户笔记，必要时检索 arXiv 元数据（不下载 PDF）。\n\
   规则：\n\
   1. 先 search_library，再按需 search_arxiv / search_annotations / search_excerpts\n\
   2. 用 get_paper 深入单篇；可用 research_subtopic 委派 1～2 个子问题\n\
   3. 可用 update_outline 维护章节骨架\n\
   4. 证据足够后必须调用 finish_research(summary=给 Writer 的备忘)\n\
   5. 引用只使用工具返回的 [src-xxx] 编号\n\
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
