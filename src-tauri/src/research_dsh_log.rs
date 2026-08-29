use super::*;
use crate::research_dsh_store;
use crate::research_llm::LlmToolCall;
use crate::research_tools::{tool_openai_schema, ToolSpec};

pub(crate) struct DshRecorder {
  workspace: PathBuf,
  child_id: Option<String>,
  provider: String,
  model: String,
  next_turn: u32,
  next_msg: u64,
}

impl DshRecorder {
  pub fn open(workspace: &Path, provider: &str, model: &str) -> Result<Self> {
    Self::open_target(workspace, None, provider, model)
  }

  pub fn open_child(workspace: &Path, child_id: &str, provider: &str, model: &str) -> Result<Self> {
    Self::open_target(workspace, Some(child_id.to_string()), provider, model)
  }

  fn open_target(workspace: &Path, child_id: Option<String>, provider: &str, model: &str) -> Result<Self> {
    let snapshot = if let Some(child_id) = child_id.as_deref() {
      research_dsh_store::load_child_snapshot(workspace, child_id)
    } else {
      research_dsh_store::load_snapshot(workspace)
    };
    let snapshot_result = snapshot;
    let next_turn = if let Ok(ref snapshot) = snapshot_result {
      let max_turn = snapshot
        .events
        .iter()
        .filter(|event| event.get("type").and_then(|v| v.as_str()) == Some("turn/start"))
        .filter_map(|event| event.pointer("/data/turn").and_then(|v| v.as_u64()))
        .max()
        .unwrap_or(0) as u32;
      max_turn + 1
    } else {
      1
    };
    let next_msg = snapshot_result
      .map(|snapshot| snapshot.events.len() as u64 + 1)
      .unwrap_or(1);
    Ok(Self {
      workspace: workspace.to_path_buf(),
      child_id,
      provider: provider.into(),
      model: model.into(),
      next_turn,
      next_msg,
    })
  }

  fn alloc_msg_id(&mut self) -> String {
    let id = self.next_msg;
    self.next_msg += 1;
    format!("msg-{id}")
  }

  fn append(&mut self, event_type: &str, data: serde_json::Value, surface_op: Option<&str>) -> Result<()> {
    let mut event = serde_json::json!({ "type": event_type, "data": data });
    if let Some(op) = surface_op {
      event["surfaceOp"] = serde_json::json!(op);
    }
    self.append_raw(event)
  }

  fn append_raw(&mut self, event: serde_json::Value) -> Result<()> {
    if let Some(child_id) = self.child_id.as_deref() {
      research_dsh_store::append_child_event(&self.workspace, child_id, &event)?;
    } else {
      research_dsh_store::append_event(&self.workspace, &event)?;
    }
    Ok(())
  }

  pub fn begin_session_turn(&mut self, user_text: &str) -> Result<u32> {
    let turn = self.next_turn;
    self.next_turn += 1;
    self.append("turn/start", serde_json::json!({ "turn": turn }), None)?;
    self.user_message(user_text, UserMessageKind::User)?;
    Ok(turn)
  }

  pub fn user_message(&mut self, text: &str, kind: UserMessageKind) -> Result<()> {
    let id = self.alloc_msg_id();
    let source = match kind {
      UserMessageKind::User => serde_json::json!({ "kind": "user" }),
      UserMessageKind::Inject { plugin, summary } => serde_json::json!({
        "kind": "plugin",
        "plugin": plugin,
        "form": "notice",
        "summary": summary
      }),
    };
    let data = serde_json::json!({
      "id": id,
      "role": "user",
      "content": [{ "type": "text", "text": text }],
      "source": source
    });
    self.append("user/message", data, Some("append"))
  }

  pub fn request_header(
    &mut self,
    system: &str,
    tools: &[ToolSpec],
    reason: &str,
  ) -> Result<()> {
    let tool_schemas: Vec<serde_json::Value> = tools.iter().map(tool_openai_schema).collect();
    let mut header = serde_json::json!({
      "config": { "provider": self.provider, "model": self.model },
      "system": system
    });
    if !tool_schemas.is_empty() {
      header["tools"] = serde_json::Value::Array(tool_schemas);
    }
    self.append(
      "request/header",
      serde_json::json!({ "header": header, "reason": reason }),
      None,
    )
  }

  pub fn step_start(&mut self, turn: u32, step: u32) -> Result<()> {
    self.append("step/start", serde_json::json!({ "turn": turn, "step": step }), None)
  }

  pub fn step_end(&mut self, turn: u32, step: u32) -> Result<()> {
    self.append("step/end", serde_json::json!({ "turn": turn, "step": step }), None)
  }

  pub fn turn_end_completed(&mut self, turn: u32) -> Result<()> {
    self.append(
      "turn/end",
      serde_json::json!({ "turn": turn, "reason": { "kind": "completed" } }),
      None,
    )
  }

  pub fn session_end_seed(&mut self) -> Result<()> {
    self.append("session/end-seed", serde_json::json!({}), None)
  }

  pub fn assistant_message(
    &mut self,
    turn: u32,
    step: u32,
    text: Option<&str>,
    tool_calls: &[LlmToolCall],
  ) -> Result<()> {
    let id = self.alloc_msg_id();
    let mut content: Vec<serde_json::Value> = Vec::new();
    if let Some(text) = text.filter(|value| !value.is_empty()) {
      content.push(serde_json::json!({ "type": "text", "text": text }));
    }
    for call in tool_calls {
      content.push(serde_json::json!({
        "type": "tool-call",
        "id": call.id,
        "name": call.name,
        "arguments": call.arguments.to_string()
      }));
    }
    if content.is_empty() {
      content.push(serde_json::json!({ "type": "text", "text": "" }));
    }
    let message = serde_json::json!({
      "id": id,
      "role": "assistant",
      "content": content,
      "source": { "kind": "model", "provider": self.provider, "model": self.model }
    });
    self.append(
      "assistant/message",
      serde_json::json!({ "turn": turn, "step": step, "message": message }),
      Some("append"),
    )
  }

  pub fn tool_call(&mut self, turn: u32, step: u32, call: &LlmToolCall) -> Result<()> {
    self.append(
      "tool/call",
      serde_json::json!({
        "turn": turn,
        "step": step,
        "callId": call.id,
        "name": call.name,
        "arguments": call.arguments.to_string()
      }),
      None,
    )
  }

  pub fn tool_result(
    &mut self,
    turn: u32,
    step: u32,
    call_id: &str,
    observation: &str,
    is_error: bool,
  ) -> Result<()> {
    let id = self.alloc_msg_id();
    let mut block = serde_json::json!({
      "type": "tool-result",
      "toolCallId": call_id,
      "content": [{ "type": "text", "text": observation }]
    });
    if is_error {
      block["isError"] = serde_json::json!(true);
    }
    let message = serde_json::json!({
      "id": id,
      "role": "user",
      "content": [block],
      "source": { "kind": "tool", "callId": call_id }
    });
    self.append(
      "tool/result",
      serde_json::json!({ "turn": turn, "step": step, "message": message }),
      Some("append"),
    )
  }

  pub fn finish_step(&mut self, turn: u32, step: u32) -> Result<()> {
    self.step_end(turn, step)
  }

  pub fn compaction_start(&mut self, compaction_id: &str, turn: u32) -> Result<()> {
    self.append(
      "compaction/start",
      serde_json::json!({
        "compactionId": compaction_id,
        "turn": turn
      }),
      None,
    )
  }

  pub fn compaction_summary(
    &mut self,
    compaction_id: &str,
    summary: &str,
    start: i64,
    end: i64,
    shadowed_seqs: &[i64],
    shadowed_token_count: u64,
    model: &str,
  ) -> Result<()> {
    self.append(
      "compaction/summary",
      serde_json::json!({
        "compactionId": compaction_id,
        "summary": [{ "type": "text", "text": summary }],
        "shadowedRange": { "start": start, "end": end },
        "shadowedSeqs": shadowed_seqs,
        "shadowedTokenCount": shadowed_token_count,
        "provider": self.provider,
        "model": model
      }),
      None,
    )
  }

  pub fn compaction_checkpoint(
    &mut self,
    compaction_id: &str,
    summary: &str,
    start: i64,
    end: i64,
    shadowed_seqs: &[i64],
  ) -> Result<()> {
    let id = self.alloc_msg_id();
    let data = serde_json::json!({
      "id": id,
      "role": "user",
      "content": [{ "type": "text", "text": summary }],
      "source": {
        "kind": "plugin",
        "plugin": "compact",
        "compactionId": compaction_id
      }
    });
    let event = serde_json::json!({
      "type": "user/message",
      "data": data,
      "surfaceOp": { "op": "replace", "start": start, "end": end },
      "sourceEventSeqs": shadowed_seqs
    });
    self.append_raw(event)
  }

  pub fn compaction_end(&mut self, compaction_id: &str, turn: u32, error: Option<&str>) -> Result<()> {
    let mut data = serde_json::json!({
      "compactionId": compaction_id,
      "turn": turn
    });
    if let Some(error) = error {
      data["error"] = serde_json::json!(error);
    }
    self.append("compaction/end", data, None)
  }
}

pub(crate) enum UserMessageKind<'a> {
  User,
  Inject { plugin: &'a str, summary: &'a str },
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::research_dsh_store;

  #[test]
  fn dsh_recorder_writes_surface_events() {
    let dir = std::env::temp_dir().join(format!("dsh-log-test-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    research_dsh_store::init_session_log(&dir, "sess-1").unwrap();
    let mut log = DshRecorder::open(&dir, "openai-compatible", "test-model").unwrap();
    let turn = log.begin_session_turn("研究问题").unwrap();
    log.request_header("system", &[], "initial").unwrap();
    log.step_start(turn, 1).unwrap();
    log.assistant_message(turn, 1, Some("hello"), &[]).unwrap();
    log.finish_step(turn, 1).unwrap();
    log.turn_end_completed(turn).unwrap();
    let snapshot = research_dsh_store::load_snapshot(&dir).unwrap();
    assert!(snapshot.events.len() >= 6);
    let types: Vec<_> = snapshot
      .events
      .iter()
      .filter_map(|event| event.get("type").and_then(|v| v.as_str()))
      .collect();
    assert!(types.contains(&"user/message"));
    assert!(types.contains(&"assistant/message"));
    let _ = fs::remove_dir_all(dir);
  }
}
