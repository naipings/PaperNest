
#[derive(Clone, Debug)]
pub(crate) struct SurfaceFoldReplacement {
  pub seq: i64,
  pub start: i64,
  pub end: i64,
  pub shadowed_seqs: Vec<i64>,
}

#[derive(Clone, Debug)]
pub(crate) struct SurfaceFoldResult {
  pub nodes: Vec<i64>,
  pub replacements: Vec<SurfaceFoldReplacement>,
}

fn event_seq(event: &serde_json::Value) -> Option<i64> {
  event.get("seq").and_then(|value| value.as_i64())
}

fn surface_op(event: &serde_json::Value) -> Option<&serde_json::Value> {
  event.get("surfaceOp")
}

fn is_surface_eligible(event: &serde_json::Value) -> bool {
  matches!(
    event.get("type").and_then(|value| value.as_str()),
    Some("user/message" | "assistant/message" | "tool/result")
  )
}

pub(crate) fn fold_surface(events: &[serde_json::Value]) -> SurfaceFoldResult {
  let mut nodes: Vec<i64> = Vec::new();
  let mut replacements = Vec::new();
  for (index, event) in events.iter().enumerate() {
    let expected_seq = (index + 1) as i64;
    let Some(seq) = event_seq(event) else { continue };
    if seq != expected_seq {
      continue;
    }
    if !is_surface_eligible(event) {
      continue;
    }
    let Some(surface_op) = surface_op(event) else { continue };
    if surface_op == &serde_json::json!("append") {
      nodes.push(seq);
      continue;
    }
    let Some(start) = surface_op.get("start").and_then(|value| value.as_i64()) else {
      continue;
    };
    let Some(end) = surface_op.get("end").and_then(|value| value.as_i64()) else {
      continue;
    };
    let start_idx = nodes.iter().position(|value| *value == start);
    let end_idx = nodes.iter().position(|value| *value == end);
    let (Some(start_idx), Some(end_idx)) = (start_idx, end_idx) else {
      continue;
    };
    if start_idx > end_idx {
      continue;
    }
    let shadowed_seqs = nodes[start_idx..=end_idx].to_vec();
    nodes.splice(start_idx..=end_idx, [seq]);
    replacements.push(SurfaceFoldReplacement {
      seq,
      start,
      end,
      shadowed_seqs,
    });
  }
  SurfaceFoldResult { nodes, replacements }
}

fn event_delta(event: &serde_json::Value) -> i32 {
  match event.get("type").and_then(|value| value.as_str()) {
    Some("assistant/message") => event
      .pointer("/data/message/content")
      .and_then(|value| value.as_array())
      .map(|blocks| {
        blocks
          .iter()
          .filter(|block| block.get("type").and_then(|value| value.as_str()) == Some("tool-call"))
          .count() as i32
      })
      .unwrap_or(0),
    Some("tool/result") => -1,
    _ => 0,
  }
}

pub(crate) fn tool_pairing_balanced_before(events: &[serde_json::Value], nodes: &[i64], seq: i64) -> bool {
  let mut in_progress = 0i32;
  for node in nodes {
    if *node == seq {
      return in_progress == 0;
    }
    let index = (*node - 1) as usize;
    let Some(event) = events.get(index) else { return false };
    in_progress += event_delta(event);
    if in_progress < 0 {
      return false;
    }
  }
  false
}

pub(crate) fn tool_pairing_balanced_after(events: &[serde_json::Value], nodes: &[i64], seq: i64) -> bool {
  let mut in_progress = 0i32;
  for node in nodes {
    let index = (*node - 1) as usize;
    let Some(event) = events.get(index) else { return false };
    in_progress += event_delta(event);
    if in_progress < 0 {
      return false;
    }
    if *node == seq {
      return in_progress == 0;
    }
  }
  false
}

pub(crate) fn event_by_seq<'a>(events: &'a [serde_json::Value], seq: i64) -> Option<&'a serde_json::Value> {
  events.get((seq - 1) as usize).filter(|event| event_seq(event) == Some(seq))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn fold_surface_replace_shadows_range() {
    let events = vec![
      serde_json::json!({ "seq": 1, "type": "user/message", "surfaceOp": "append", "data": { "role": "user", "content": [{ "type": "text", "text": "a" }] } }),
      serde_json::json!({ "seq": 2, "type": "assistant/message", "surfaceOp": "append", "data": { "message": { "role": "assistant", "content": [{ "type": "text", "text": "b" }] } } }),
      serde_json::json!({
        "seq": 3,
        "type": "user/message",
        "surfaceOp": { "op": "replace", "start": 1, "end": 2 },
        "data": { "role": "user", "content": [{ "type": "text", "text": "summary" }] }
      }),
    ];
    let folded = fold_surface(&events);
    assert_eq!(folded.nodes, vec![3]);
    assert_eq!(folded.replacements.len(), 1);
    assert_eq!(folded.replacements[0].shadowed_seqs, vec![1, 2]);
  }

  #[test]
  fn fold_surface_stress_many_append_then_replace() {
    let mut events = Vec::new();
    for i in 1..=120 {
      let typ = if i % 2 == 1 { "user/message" } else { "assistant/message" };
      let data = if typ == "user/message" {
        serde_json::json!({ "role": "user", "content": [{ "type": "text", "text": format!("u{i}") }] })
      } else {
        serde_json::json!({ "message": { "role": "assistant", "content": [{ "type": "text", "text": format!("a{i}") }] } })
      };
      events.push(serde_json::json!({
        "seq": i,
        "type": typ,
        "surfaceOp": "append",
        "data": data
      }));
    }
    events.push(serde_json::json!({
      "seq": 121,
      "type": "user/message",
      "surfaceOp": { "op": "replace", "start": 1, "end": 80 },
      "data": { "role": "user", "content": [{ "type": "text", "text": "ckpt" }] }
    }));
    let folded = fold_surface(&events);
    assert_eq!(folded.nodes[0], 121);
    assert_eq!(folded.nodes.len(), 41);
    assert!(tool_pairing_balanced_after(&events, &folded.nodes, 121));
  }
}
