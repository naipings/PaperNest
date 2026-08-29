use super::*;
use std::io::{BufRead, Write};

pub const SESSION_FORMAT_VERSION: i64 = 0;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DshSessionHeader {
  #[serde(rename = "type")]
  pub kind: String,
  pub version: i64,
  pub id: String,
  pub created_at: i64,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cwd: Option<String>,
  #[serde(default)]
  pub delegation_depth: i64,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DshSessionSnapshot {
  pub header: DshSessionHeader,
  pub events: Vec<serde_json::Value>,
}

fn dsh_dir(workspace: &Path) -> PathBuf {
  workspace.join(".dsh-session")
}

fn log_path(workspace: &Path) -> PathBuf {
  dsh_dir(workspace).join("session.jsonl")
}

fn child_log_path(workspace: &Path, child_id: &str) -> PathBuf {
  dsh_dir(workspace).join("children").join(child_id).join("session.jsonl")
}

pub fn completed_turn_prefix(events: &[serde_json::Value]) -> Vec<serde_json::Value> {
  let last_end = events
    .iter()
    .rfind(|event| event.get("type").and_then(|value| value.as_str()) == Some("turn/end"));
  let Some(last_end) = last_end else {
    return vec![];
  };
  let boundary = event_seq(last_end).unwrap_or(events.len() as i64);
  events
    .iter()
    .filter(|event| event_seq(event).unwrap_or(0) <= boundary)
    .cloned()
    .collect()
}

fn write_log_file(path: &Path, header: &DshSessionHeader, events: &[serde_json::Value]) -> Result<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(err)?;
  }
  let mut file = fs::File::create(path).map_err(err)?;
  let header_line = serde_json::json!({
    "type": header.kind,
    "version": header.version,
    "id": header.id,
    "createdAt": header.created_at,
    "cwd": header.cwd,
    "delegationDepth": header.delegation_depth,
  });
  writeln!(file, "{}", serde_json::to_string(&header_line).map_err(err)?).map_err(err)?;
  for event in events {
    writeln!(file, "{}", serde_json::to_string(event).map_err(err)?).map_err(err)?;
  }
  Ok(())
}

pub fn write_forked_session(
  workspace: &Path,
  session_id: &str,
  parent_header: &DshSessionHeader,
  seed: &[serde_json::Value],
) -> Result<()> {
  let header = DshSessionHeader {
    kind: "session".into(),
    version: SESSION_FORMAT_VERSION,
    id: session_id.into(),
    created_at: Utc::now().timestamp_millis(),
    cwd: Some(workspace.to_string_lossy().into_owned()),
    delegation_depth: parent_header.delegation_depth,
  };
  write_log_file(&log_path(workspace), &header, seed)
}

pub fn init_child_session_log(
  workspace: &Path,
  child_id: &str,
  parent_header: &DshSessionHeader,
  seed: &[serde_json::Value],
  label: &str,
) -> Result<()> {
  let header = DshSessionHeader {
    kind: "session".into(),
    version: SESSION_FORMAT_VERSION,
    id: child_id.into(),
    created_at: Utc::now().timestamp_millis(),
    cwd: Some(workspace.to_string_lossy().into_owned()),
    delegation_depth: parent_header.delegation_depth + 1,
  };
  let path = child_log_path(workspace, child_id);
  write_log_file(&path, &header, seed)?;
  append_event_at(&path, &serde_json::json!({
    "type": "subagent/descriptor",
    "data": {
      "version": 2,
      "mode": "one-shot",
      "provider": "subagent-fork-in-process",
      "label": label
    }
  }))?;
  Ok(())
}

pub fn load_child_snapshot(workspace: &Path, child_id: &str) -> Result<DshSessionSnapshot> {
  load_snapshot_at(&child_log_path(workspace, child_id))
}

fn load_snapshot_at(path: &Path) -> Result<DshSessionSnapshot> {
  if !path.exists() {
    return Err("DSH session log 不存在".into());
  }
  let file = fs::File::open(path).map_err(err)?;
  let reader = std::io::BufReader::new(file);
  let mut header: Option<DshSessionHeader> = None;
  let mut events = Vec::new();
  for line in reader.lines() {
    let line = line.map_err(err)?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).map_err(err)?;
    if value.get("type").and_then(|v| v.as_str()) == Some("session") {
      header = Some(serde_json::from_value(value).map_err(err)?);
      continue;
    }
    events.push(value);
  }
  let header = header.ok_or_else(|| "DSH session log 缺少 header 行".to_string())?;
  Ok(DshSessionSnapshot { header, events })
}

pub fn append_event_at(path: &Path, event: &serde_json::Value) -> Result<serde_json::Value> {
  if !path.exists() {
    return Err("DSH session log 不存在".into());
  }
  let snapshot = load_snapshot_at(path)?;
  let seq = snapshot.events.len() as i64 + 1;
  let time = Utc::now().timestamp_millis();
  let mut stored = event.clone();
  if let Some(obj) = stored.as_object_mut() {
    obj.insert("seq".into(), serde_json::json!(seq));
    obj.insert("time".into(), serde_json::json!(time));
  } else {
    return Err("DSH event 必须是 JSON 对象".into());
  }
  let mut file = fs::OpenOptions::new().append(true).open(path).map_err(err)?;
  let line = serde_json::to_string(&stored).map_err(err)?;
  writeln!(file, "{line}").map_err(err)?;
  Ok(stored)
}

pub fn append_child_event(workspace: &Path, child_id: &str, event: &serde_json::Value) -> Result<serde_json::Value> {
  append_event_at(&child_log_path(workspace, child_id), event)
}

pub fn init_session_log(workspace: &Path, session_id: &str) -> Result<()> {
  let dir = dsh_dir(workspace);
  fs::create_dir_all(&dir).map_err(err)?;
  let path = log_path(workspace);
  if path.exists() {
    return Ok(());
  }
  let created_at = Utc::now().timestamp_millis();
  let header = DshSessionHeader {
    kind: "session".into(),
    version: SESSION_FORMAT_VERSION,
    id: session_id.into(),
    created_at,
    cwd: Some(workspace.to_string_lossy().into_owned()),
    delegation_depth: 0,
  };
  let mut file = fs::File::create(path).map_err(err)?;
  let line = serde_json::to_string(&header).map_err(err)?;
  writeln!(file, "{line}").map_err(err)?;
  Ok(())
}

pub fn append_event(workspace: &Path, event: &serde_json::Value) -> Result<serde_json::Value> {
  let path = log_path(workspace);
  if !path.exists() {
    return Err("DSH session log 不存在".into());
  }
  let events = read_events(workspace)?;
  let seq = events.len() as i64 + 1;
  let time = Utc::now().timestamp_millis();
  let mut stored = event.clone();
  if let Some(obj) = stored.as_object_mut() {
    obj.insert("seq".into(), serde_json::json!(seq));
    obj.insert("time".into(), serde_json::json!(time));
  } else {
    return Err("DSH event 必须是 JSON 对象".into());
  }
  let mut file = fs::OpenOptions::new().append(true).open(path).map_err(err)?;
  let line = serde_json::to_string(&stored).map_err(err)?;
  writeln!(file, "{line}").map_err(err)?;
  Ok(stored)
}

fn read_events(workspace: &Path) -> Result<Vec<serde_json::Value>> {
  let path = log_path(workspace);
  if !path.exists() {
    return Ok(vec![]);
  }
  let file = fs::File::open(path).map_err(err)?;
  let reader = std::io::BufReader::new(file);
  let mut events = Vec::new();
  for (index, line) in reader.lines().enumerate() {
    let line = line.map_err(err)?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).map_err(err)?;
    if index == 0 && value.get("type").and_then(|v| v.as_str()) == Some("session") {
      continue;
    }
    events.push(value);
  }
  Ok(events)
}

pub fn event_seq(event: &serde_json::Value) -> Result<i64> {
  event
    .get("seq")
    .and_then(|value| value.as_i64())
    .ok_or_else(|| "DSH 事件缺少 seq".to_string())
}

pub fn default_resume_boundary(events: &[serde_json::Value]) -> Result<i64> {
  if events.is_empty() {
    return Err("没有可恢复的事件".into());
  }
  let mut last_closed: Option<i64> = None;
  let mut open_turn = false;
  for event in events {
    let seq = event_seq(event)?;
    match event.get("type").and_then(|value| value.as_str()) {
      Some("turn/start") => open_turn = true,
      Some("turn/end") => {
        open_turn = false;
        last_closed = Some(seq);
      }
      _ => {}
    }
  }
  if open_turn {
    if let Some(step_end) = events.iter().rev().find_map(|event| {
      if event.get("type")?.as_str()? != "step/end" {
        return None;
      }
      event_seq(event).ok()
    }) {
      return Ok(step_end);
    }
    // 草稿仅有 turn/start + 用户消息：默认取末事件，供分叉；恢复仍由 validate_resume_boundary 拒绝未闭合 turn
    return event_seq(events.last().unwrap());
  }
  last_closed
    .or_else(|| events.last().and_then(|event| event_seq(event).ok()))
    .ok_or_else(|| "没有可恢复的事件".into())
}

pub fn validate_resume_boundary(events: &[serde_json::Value], boundary_seq: i64) -> Result<()> {
  validate_boundary_range(events, boundary_seq)?;
  if prefix_has_open_turn(events, boundary_seq) {
    return Err("恢复点不能落在未闭合的 turn 内".into());
  }
  Ok(())
}

pub fn validate_fork_boundary(events: &[serde_json::Value], boundary_seq: i64) -> Result<()> {
  validate_boundary_range(events, boundary_seq)?;
  if !prefix_has_open_turn(events, boundary_seq) {
    return Ok(());
  }
  let max_seq = events.iter().filter_map(|event| event_seq(event).ok()).max().unwrap_or(0);
  if boundary_seq == max_seq {
    return Ok(());
  }
  Err("分叉点不能落在未闭合 turn 的中间；请选到该 turn 末尾或已闭合边界".into())
}

fn validate_boundary_range(events: &[serde_json::Value], boundary_seq: i64) -> Result<()> {
  if events.is_empty() {
    return Err("没有可恢复的事件".into());
  }
  let max_seq = events.iter().filter_map(|event| event_seq(event).ok()).max().unwrap_or(0);
  if boundary_seq < 1 || boundary_seq > max_seq {
    return Err(format!("边界 seq 必须在 1～{max_seq} 之间").into());
  }
  Ok(())
}

fn prefix_has_open_turn(events: &[serde_json::Value], boundary_seq: i64) -> bool {
  let mut open_turn: Option<u32> = None;
  for event in events.iter().filter(|event| event_seq(event).unwrap_or(0) <= boundary_seq) {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("turn/start") => {
        open_turn = event
          .pointer("/data/turn")
          .and_then(|value| value.as_u64())
          .map(|value| value as u32);
      }
      Some("turn/end") => {
        let turn = event
          .pointer("/data/turn")
          .and_then(|value| value.as_u64())
          .map(|value| value as u32);
        if open_turn == turn {
          open_turn = None;
        }
      }
      _ => {}
    }
  }
  open_turn.is_some()
}

pub fn fork_prefix(events: &[serde_json::Value], boundary_seq: i64) -> Result<Vec<serde_json::Value>> {
  validate_fork_boundary(events, boundary_seq)?;
  Ok(events
    .iter()
    .filter(|event| event_seq(event).unwrap_or(0) <= boundary_seq)
    .cloned()
    .collect())
}

fn rewrite_log(workspace: &Path, header: &DshSessionHeader, events: &[serde_json::Value]) -> Result<()> {
  write_log_file(&log_path(workspace), header, events)
}

pub fn truncate_to_boundary(workspace: &Path, boundary_seq: i64) -> Result<DshSessionSnapshot> {
  let snapshot = load_snapshot(workspace)?;
  validate_resume_boundary(&snapshot.events, boundary_seq)?;
  let kept: Vec<_> = snapshot
    .events
    .iter()
    .filter(|event| event_seq(event).unwrap_or(0) <= boundary_seq)
    .cloned()
    .collect();
  rewrite_log(workspace, &snapshot.header, &kept)?;
  Ok(DshSessionSnapshot {
    header: snapshot.header,
    events: kept,
  })
}

pub fn load_snapshot(workspace: &Path) -> Result<DshSessionSnapshot> {
  let path = log_path(workspace);
  if !path.exists() {
    return Err("DSH session log 不存在".into());
  }
  let file = fs::File::open(path).map_err(err)?;
  let reader = std::io::BufReader::new(file);
  let mut header: Option<DshSessionHeader> = None;
  let mut events = Vec::new();
  for line in reader.lines() {
    let line = line.map_err(err)?;
    let trimmed = line.trim();
    if trimmed.is_empty() {
      continue;
    }
    let value: serde_json::Value = serde_json::from_str(trimmed).map_err(err)?;
    if value.get("type").and_then(|v| v.as_str()) == Some("session") {
      header = Some(serde_json::from_value(value).map_err(err)?);
      continue;
    }
    events.push(value);
  }
  let header = header.ok_or_else(|| "DSH session log 缺少 header 行".to_string())?;
  Ok(DshSessionSnapshot { header, events })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn completed_turn_prefix_ends_at_last_turn_end() {
    let events = vec![
      serde_json::json!({ "seq": 1, "type": "turn/start", "data": { "turn": 1 } }),
      serde_json::json!({ "seq": 2, "type": "turn/end", "data": { "turn": 1, "reason": { "kind": "completed" } } }),
      serde_json::json!({ "seq": 3, "type": "turn/start", "data": { "turn": 2 } }),
    ];
    let prefix = completed_turn_prefix(&events);
    assert_eq!(prefix.len(), 2);
    assert_eq!(prefix.last().unwrap()["type"], "turn/end");
  }

  #[test]
  fn truncate_keeps_prefix_and_default_boundary() {
    let dir = std::env::temp_dir().join(format!("dsh-truncate-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    init_session_log(&dir, "sess-truncate").unwrap();
    for index in 1..=2u32 {
      append_event(&dir, &serde_json::json!({ "type": "turn/start", "data": { "turn": index } })).unwrap();
      append_event(
        &dir,
        &serde_json::json!({ "type": "turn/end", "data": { "turn": index, "reason": { "kind": "completed" } } }),
      )
      .unwrap();
    }
    let snapshot = truncate_to_boundary(&dir, 2).unwrap();
    assert_eq!(snapshot.events.len(), 2);
    assert_eq!(default_resume_boundary(&snapshot.events).unwrap(), 2);
    let _ = fs::remove_dir_all(dir);
  }

  #[test]
  fn draft_open_turn_allows_fork_at_tail_but_not_resume() {
    let events = vec![
      serde_json::json!({ "seq": 1, "type": "turn/start", "data": { "turn": 1 } }),
      serde_json::json!({
        "seq": 2,
        "type": "user/message",
        "surfaceOp": "append",
        "data": { "role": "user", "content": [{ "type": "text", "text": "q" }] }
      }),
    ];
    assert_eq!(default_resume_boundary(&events).unwrap(), 2);
    assert!(validate_resume_boundary(&events, 2).is_err());
    assert!(validate_fork_boundary(&events, 2).is_ok());
    assert!(validate_fork_boundary(&events, 1).is_err());
    let seed = fork_prefix(&events, 2).unwrap();
    assert_eq!(seed.len(), 2);
  }
}
