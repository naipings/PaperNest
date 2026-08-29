use super::*;
use crate::research_dsh_surface::{event_by_seq, fold_surface};
use crate::research_react::ReactFinish;

pub(crate) fn derive_openai_messages(events: &[serde_json::Value]) -> Vec<serde_json::Value> {
  let system = events
    .iter()
    .rev()
    .find_map(|event| {
      if event.get("type")?.as_str()? != "request/header" {
        return None;
      }
      event.pointer("/data/header/system")?.as_str().map(str::to_string)
    })
    .unwrap_or_else(|| {
      "你是 PaperNest 文献调研 Agent。通过工具检索本地论文库与用户笔记，必要时检索 arXiv 元数据（不下载 PDF）。"
        .to_string()
    });

  let mut messages = vec![serde_json::json!({ "role": "system", "content": system })];
  let folded = fold_surface(events);
  for seq in folded.nodes {
    let Some(event) = event_by_seq(events, seq) else { continue };
    if let Some(message) = derive_event_openai_message(event) {
      messages.push(message);
    }
  }
  messages
}

pub(crate) fn derive_event_openai_message(event: &serde_json::Value) -> Option<serde_json::Value> {
  match event.get("type").and_then(|value| value.as_str()) {
    Some("user/message") => user_message_from_event(event),
    Some("assistant/message") => assistant_message_from_event(event),
    Some("tool/result") => tool_result_from_event(event),
    _ => None,
  }
}

fn user_message_from_event(event: &serde_json::Value) -> Option<serde_json::Value> {
  let message = event.pointer("/data")?;
  let text = message_content_text(message.get("content")?)?;
  if text.is_empty() {
    return None;
  }
  Some(serde_json::json!({ "role": "user", "content": text }))
}

fn assistant_message_from_event(event: &serde_json::Value) -> Option<serde_json::Value> {
  let message = event.pointer("/data/message")?;
  let content = message.get("content")?;
  let text = message_content_text(content).unwrap_or_default();
  let tool_calls: Vec<serde_json::Value> = content
    .as_array()?
    .iter()
    .filter_map(|block| {
      if block.get("type")?.as_str()? != "tool-call" {
        return None;
      }
      Some(serde_json::json!({
        "id": block.get("id")?,
        "type": "function",
        "function": {
          "name": block.get("name")?,
          "arguments": block.get("arguments")?,
        }
      }))
    })
    .collect();
  if text.is_empty() && tool_calls.is_empty() {
    return None;
  }
  let mut body = serde_json::json!({ "role": "assistant", "content": text });
  if !tool_calls.is_empty() {
    body["tool_calls"] = serde_json::Value::Array(tool_calls);
  }
  Some(body)
}

fn tool_result_from_event(event: &serde_json::Value) -> Option<serde_json::Value> {
  let block = event.pointer("/data/message/content/0")?;
  if block.get("type")?.as_str()? != "tool-result" {
    return None;
  }
  let call_id = block.get("toolCallId")?.as_str()?;
  let text = message_content_text(block.get("content")?)?;
  Some(serde_json::json!({
    "role": "tool",
    "tool_call_id": call_id,
    "content": text,
  }))
}

fn message_content_text(content: &serde_json::Value) -> Option<String> {
  let blocks = content.as_array()?;
  let mut parts = Vec::new();
  for block in blocks {
    if block.get("type")?.as_str()? == "text" {
      if let Some(text) = block.get("text").and_then(|value| value.as_str()) {
        if !text.is_empty() {
          parts.push(text.to_string());
        }
      }
    }
  }
  if parts.is_empty() {
    None
  } else {
    Some(parts.join("\n"))
  }
}

pub(crate) enum ResumeStage {
  React {
    messages: Vec<serde_json::Value>,
    react_turn: u32,
    start_round: u32,
    tool_calls_used: u32,
  },
  PostReact {
    finish: ReactFinish,
  },
}

/// ReAct 主循环的 turn 由「带 tools 的 request/header」标识：Reviewer 与 Writer 开的 turn 不带工具。
/// 多轮追问会产生多个 ReAct turn，续跑只关心最后一个。
pub(crate) fn last_react_turn(events: &[serde_json::Value]) -> u32 {
  let mut current = 0u32;
  let mut latest = 0u32;
  for event in events {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("turn/start") => {
        current = event.pointer("/data/turn").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
      }
      Some("request/header") if event.pointer("/data/header/tools").is_some() => {
        latest = latest.max(current);
      }
      _ => {}
    }
  }
  latest.max(1)
}

fn event_turn(event: &serde_json::Value) -> u32 {
  event.pointer("/data/turn").and_then(|value| value.as_u64()).unwrap_or(0) as u32
}

pub(crate) fn close_orphan_react_steps(
  dsh: &mut crate::research_dsh_log::DshRecorder,
  events: &[serde_json::Value],
) -> Result<()> {
  let react_turn = last_react_turn(events);
  let mut open_step: Option<u32> = None;
  for event in events {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("step/start") if event_turn(event) == react_turn => {
        open_step = Some(event.pointer("/data/step").and_then(|value| value.as_u64()).unwrap_or(0) as u32);
      }
      Some("step/end") if event_turn(event) == react_turn => {
        let step = event.pointer("/data/step").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
        if open_step == Some(step) {
          open_step = None;
        }
      }
      _ => {}
    }
  }
  if let Some(step) = open_step.filter(|s| *s > 0) {
    dsh.step_end(react_turn, step)?;
  }
  Ok(())
}

/// 追问会开新 turn。历史里若还留着未闭合的 turn（上次运行中途失败），先收尾，
/// 否则 DSH 轨迹会把两个 turn/start 当成重复起点而拒绝渲染。
pub(crate) fn close_open_turn(
  dsh: &mut crate::research_dsh_log::DshRecorder,
  events: &[serde_json::Value],
) -> Result<()> {
  let mut open: Option<u32> = None;
  for event in events {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("turn/start") => open = Some(event_turn(event)),
      Some("turn/end") if open == Some(event_turn(event)) => open = None,
      _ => {}
    }
  }
  if let Some(turn) = open {
    dsh.turn_end_completed(turn)?;
  }
  Ok(())
}

pub(crate) fn detect_resume_stage(events: &[serde_json::Value], workspace: &Path) -> Result<ResumeStage> {
  let react_turn = last_react_turn(events);
  if let Some(summary) = react_finish_summary(events, react_turn) {
    let sources = crate::research::read_sources(workspace)?;
    return Ok(ResumeStage::PostReact {
      finish: ReactFinish { summary, sources },
    });
  }
  let (start_round, tool_calls_used) = react_progress(events, react_turn);
  let messages = derive_openai_messages(events);
  if messages.len() <= 1 {
    return Err("没有可续跑的对话事件".into());
  }
  Ok(ResumeStage::React {
    messages,
    react_turn,
    start_round,
    tool_calls_used,
  })
}

fn react_finish_summary(events: &[serde_json::Value], react_turn: u32) -> Option<String> {
  let mut pending_call: Option<String> = None;
  for event in events.iter().filter(|event| event_turn(event) == react_turn) {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("tool/call") => {
        if event.pointer("/data/name").and_then(|value| value.as_str()) == Some("finish_research") {
          pending_call = event
            .pointer("/data/callId")
            .and_then(|value| value.as_str())
            .map(str::to_string);
        }
      }
      Some("tool/result") => {
        let Some(call_id) = pending_call.as_ref() else { continue };
        if event.pointer("/data/message/content/0/toolCallId").and_then(|value| value.as_str()) != Some(call_id.as_str())
        {
          continue;
        }
        let summary = event
          .pointer("/data/message/content/0/content/0/text")
          .and_then(|value| value.as_str())
          .unwrap_or("")
          .trim()
          .to_string();
        if summary.is_empty() {
          return None;
        }
        return Some(summary);
      }
      _ => {}
    }
  }
  None
}

fn react_progress(events: &[serde_json::Value], react_turn: u32) -> (u32, u32) {
  let mut max_step = 0u32;
  let mut tool_calls_used = 0u32;
  for event in events.iter().filter(|event| event_turn(event) == react_turn) {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("step/end") => {
        let step = event.pointer("/data/step").and_then(|value| value.as_u64()).unwrap_or(0) as u32;
        max_step = max_step.max(step);
      }
      Some("tool/call") => tool_calls_used += 1,
      _ => {}
    }
  }
  (max_step + 1, tool_calls_used)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn derive_messages_from_surface_events() {
    let events = vec![
      serde_json::json!({
        "seq": 1,
        "type": "request/header",
        "data": { "header": { "system": "sys" }, "reason": "initial" }
      }),
      serde_json::json!({
        "seq": 2,
        "type": "user/message",
        "surfaceOp": "append",
        "data": {
          "role": "user",
          "content": [{ "type": "text", "text": "问题" }],
          "source": { "kind": "user" }
        }
      }),
      serde_json::json!({
        "seq": 3,
        "type": "assistant/message",
        "surfaceOp": "append",
        "data": {
          "turn": 1,
          "step": 1,
          "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": "思考" }]
          }
        }
      }),
    ];
    let messages = derive_openai_messages(&events);
    assert_eq!(messages.len(), 3);
    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[1]["content"], "问题");
  }

  #[test]
  fn derive_messages_respects_surface_replace() {
    let events = vec![
      serde_json::json!({
        "seq": 1,
        "type": "request/header",
        "data": { "header": { "system": "sys" }, "reason": "initial" }
      }),
      serde_json::json!({
        "seq": 2,
        "type": "user/message",
        "surfaceOp": "append",
        "data": {
          "role": "user",
          "content": [{ "type": "text", "text": "old" }],
          "source": { "kind": "user" }
        }
      }),
      serde_json::json!({
        "seq": 3,
        "type": "assistant/message",
        "surfaceOp": "append",
        "data": {
          "message": {
            "role": "assistant",
            "content": [{ "type": "text", "text": "gone" }]
          }
        }
      }),
      serde_json::json!({
        "seq": 4,
        "type": "user/message",
        "surfaceOp": { "op": "replace", "start": 2, "end": 3 },
        "data": {
          "role": "user",
          "content": [{ "type": "text", "text": "checkpoint" }],
          "source": { "kind": "plugin", "plugin": "compact", "compactionId": "cmp-1" }
        }
      }),
    ];
    let messages = derive_openai_messages(&events);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1]["content"], "checkpoint");
  }

  #[test]
  fn react_progress_continues_after_completed_steps() {
    let events = vec![
      serde_json::json!({ "type": "turn/start", "data": { "turn": 1 } }),
      serde_json::json!({ "type": "step/start", "data": { "turn": 1, "step": 1 } }),
      serde_json::json!({ "type": "step/end", "data": { "turn": 1, "step": 1 } }),
      serde_json::json!({ "type": "step/start", "data": { "turn": 1, "step": 2 } }),
      serde_json::json!({ "type": "step/end", "data": { "turn": 1, "step": 2 } }),
    ];
    let (start_round, _) = react_progress(&events, 1);
    assert_eq!(start_round, 3);
  }

  #[test]
  fn react_progress_after_orphan_closed_starts_next_round() {
    let events = vec![
      serde_json::json!({ "type": "turn/start", "data": { "turn": 1 } }),
      serde_json::json!({ "type": "step/start", "data": { "turn": 1, "step": 1 } }),
      serde_json::json!({ "type": "step/end", "data": { "turn": 1, "step": 1 } }),
    ];
    let (start_round, _) = react_progress(&events, 1);
    assert_eq!(start_round, 2);
  }

  /// 一轮完整调研后追问：ReAct turn 应指向新一轮，而不是被 Writer 的 turn 或首轮 finish 带偏。
  #[test]
  fn last_react_turn_skips_writer_turns_and_picks_followup() {
    let events = vec![
      serde_json::json!({ "type": "turn/start", "data": { "turn": 1 } }),
      serde_json::json!({ "type": "request/header", "data": { "header": { "system": "react", "tools": [] }, "reason": "initial" } }),
      serde_json::json!({ "type": "tool/call", "data": { "turn": 1, "callId": "c1", "name": "finish_research" } }),
      serde_json::json!({
        "type": "tool/result",
        "data": { "turn": 1, "message": { "content": [{ "type": "tool-result", "toolCallId": "c1", "content": [{ "type": "text", "text": "首轮备忘" }] }] } }
      }),
      serde_json::json!({ "type": "turn/end", "data": { "turn": 1 } }),
      serde_json::json!({ "type": "turn/start", "data": { "turn": 2 } }),
      serde_json::json!({ "type": "request/header", "data": { "header": { "system": "writer" }, "reason": "initial" } }),
      serde_json::json!({ "type": "turn/end", "data": { "turn": 2 } }),
      serde_json::json!({ "type": "turn/start", "data": { "turn": 3 } }),
      serde_json::json!({ "type": "request/header", "data": { "header": { "system": "react", "tools": [] }, "reason": "change" } }),
      serde_json::json!({ "type": "step/start", "data": { "turn": 3, "step": 1 } }),
      serde_json::json!({ "type": "step/end", "data": { "turn": 3, "step": 1 } }),
      serde_json::json!({ "type": "tool/call", "data": { "turn": 3, "callId": "c2", "name": "search_library" } }),
    ];
    assert_eq!(last_react_turn(&events), 3);
    assert_eq!(react_finish_summary(&events, 3), None);
    assert_eq!(react_finish_summary(&events, 1).as_deref(), Some("首轮备忘"));
    let (start_round, tool_calls) = react_progress(&events, 3);
    assert_eq!(start_round, 2);
    assert_eq!(tool_calls, 1);
  }
}
