use super::*;
use crate::research_dsh_log::DshRecorder;
use crate::research_dsh_surface::{
  event_by_seq, fold_surface, tool_pairing_balanced_after, tool_pairing_balanced_before,
};
use crate::research::ResearchLlmSettings;
use crate::research_llm::research_llm_with_tools;

const COMPACTION_PREAMBLE: &str = "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint.";

const COMPACTION_INSTRUCTION: &str = "You are now acting as a compaction engine for this AI literature-research assistant. Condense the conversation ABOVE into a structured checkpoint that lets another model resume the work with no loss of essential context.\n\n\
Output EXACTLY the Markdown structure below: keep every section, in order. Use terse bullets, not prose paragraphs. Write \"(none)\" for an empty section — never drop a section.\n\n\
## Primary Request and Intent\n\
## Key Technical Concepts\n\
## Files and Code\n\
## Errors and Fixes\n\
## Pending Jobs\n\
## Current Work\n\
## Next Step\n\
## Critical Context\n\n\
Rules:\n\
- Write concise Chinese or English engineering prose matching the conversation language.\n\
- Preserve exact file paths, paper ids [src-xxx], commands, error strings, identifiers, and numeric values.\n\
- Do NOT mention this summarization request or that the context was compacted.\n\
- Output only the checkpoint text: do not call any tool or take any other action.\n\
- If the conversation already contains a <compacted-summary> block, merge newer information into a single consolidated summary under the same structure.";

#[derive(Clone, Debug)]
pub(crate) struct CompactionPolicy {
  pub context_window: u64,
  pub threshold_ratio: f64,
  pub retain_ratio: f64,
  pub max_summary_tokens: u32,
}

impl CompactionPolicy {
  pub fn deep() -> Self {
    Self {
      context_window: 128_000,
      threshold_ratio: 0.8,
      retain_ratio: 0.16,
      max_summary_tokens: 8192,
    }
  }

  pub fn threshold_tokens(&self) -> u64 {
    ((self.context_window as f64) * self.threshold_ratio) as u64
  }

  pub fn retain_tokens(&self) -> u64 {
    ((self.context_window as f64) * self.retain_ratio) as u64
  }
}

pub(crate) fn estimate_openai_message_tokens(messages: &[serde_json::Value]) -> u64 {
  let chars: usize = messages
    .iter()
    .map(|message| serde_json::to_string(message).unwrap_or_default().len())
    .sum();
  (chars as u64 / 4).max(1)
}

fn compaction_locked(events: &[serde_json::Value]) -> bool {
  let mut open: Option<i64> = None;
  for event in events {
    match event.get("type").and_then(|value| value.as_str()) {
      Some("session/end-seed") => open = None,
      Some("compaction/start") => open = event.get("seq").and_then(|value| value.as_i64()),
      Some("compaction/end") => open = None,
      _ => {}
    }
  }
  open.is_some()
}

fn select_compaction_range(
  events: &[serde_json::Value],
  policy: &CompactionPolicy,
) -> Option<(i64, i64, Vec<i64>)> {
  let folded = fold_surface(events);
  let nodes = folded.nodes;
  if nodes.len() < 3 {
    return None;
  }
  let retain_budget = policy.retain_tokens();
  let mut retained_tokens = 0u64;
  let mut tail_start_idx = nodes.len();
  for (index, seq) in nodes.iter().enumerate().rev() {
    let event = event_by_seq(events, *seq)?;
    let message = crate::research_dsh_derive::derive_event_openai_message(event)?;
    retained_tokens += estimate_openai_message_tokens(&[message]);
    if retained_tokens >= retain_budget && tool_pairing_balanced_before(events, &nodes, *seq) {
      tail_start_idx = index;
      break;
    }
  }
  if tail_start_idx == 0 {
    return None;
  }
  let compact_end_idx = tail_start_idx.saturating_sub(1);
  if compact_end_idx == 0 {
    return None;
  }
  let start_seq = nodes[0];
  let end_seq = nodes[compact_end_idx];
  if !tool_pairing_balanced_after(events, &nodes, end_seq) {
    return None;
  }
  let shadowed_seqs = nodes[0..=compact_end_idx].to_vec();
  Some((start_seq, end_seq, shadowed_seqs))
}

fn shadowed_messages(events: &[serde_json::Value], shadowed_seqs: &[i64]) -> Vec<serde_json::Value> {
  shadowed_seqs
    .iter()
    .filter_map(|seq| event_by_seq(events, *seq))
    .filter_map(crate::research_dsh_derive::derive_event_openai_message)
    .collect()
}

async fn summarize_range(
  settings: &ResearchLlmSettings,
  events: &[serde_json::Value],
  shadowed_seqs: &[i64],
) -> Result<String> {
  let mut transcript = shadowed_messages(events, shadowed_seqs);
  if transcript.is_empty() {
    return Err("没有可压缩的对话内容".into());
  }
  transcript.push(serde_json::json!({
    "role": "user",
    "content": COMPACTION_INSTRUCTION
  }));
  let system = events
    .iter()
    .rev()
    .find_map(|event| {
      if event.get("type")?.as_str()? != "request/header" {
        return None;
      }
      event.pointer("/data/header/system")?.as_str().map(str::to_string)
    })
    .unwrap_or_else(|| "你是 PaperNest 文献调研压缩引擎。".into());
  let mut messages = vec![serde_json::json!({ "role": "system", "content": system })];
  messages.append(&mut transcript);
  let response = research_llm_with_tools(
    settings,
    &messages,
    &[],
    Some(CompactionPolicy::deep().max_summary_tokens),
    180,
  )
  .await?;
  let trimmed = response
    .content
    .as_deref()
    .map(str::trim)
    .filter(|text| !text.is_empty())
    .ok_or_else(|| "压缩摘要为空".to_string())?;
  Ok(format!(
    "{COMPACTION_PREAMBLE}\n\n<compacted-summary>\n{trimmed}\n</compacted-summary>"
  ))
}

pub(crate) async fn maybe_compact_if_needed(
  settings: &ResearchLlmSettings,
  dsh: &mut DshRecorder,
  events: &[serde_json::Value],
  react_turn: u32,
) -> Result<bool> {
  if settings.research_depth != "deep" {
    return Ok(false);
  }
  if compaction_locked(events) {
    return Ok(false);
  }
  let messages = crate::research_dsh_derive::derive_openai_messages(events);
  let policy = CompactionPolicy::deep();
  if estimate_openai_message_tokens(&messages) < policy.threshold_tokens() {
    return Ok(false);
  }
  let Some((start, end, shadowed_seqs)) = select_compaction_range(events, &policy) else {
    return Ok(false);
  };
  let before_tokens = estimate_openai_message_tokens(&shadowed_messages(events, &shadowed_seqs));
  let summary = match summarize_range(settings, events, &shadowed_seqs).await {
    Ok(text) => text,
    Err(_) => return Ok(false),
  };
  let after_tokens = estimate_openai_message_tokens(&[serde_json::json!({ "role": "user", "content": summary })]);
  if after_tokens >= before_tokens {
    return Ok(false);
  }
  let compaction_id = format!("cmp-{}", Uuid::new_v4());
  let shadowed_token_count = before_tokens;
  dsh.compaction_start(&compaction_id, react_turn)?;
  dsh.compaction_summary(
    &compaction_id,
    &summary,
    start,
    end,
    &shadowed_seqs,
    shadowed_token_count,
    &settings.model,
  )?;
  dsh.compaction_checkpoint(&compaction_id, &summary, start, end, &shadowed_seqs)?;
  dsh.compaction_end(&compaction_id, react_turn, None)?;
  Ok(true)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn deep_policy_thresholds() {
    let policy = CompactionPolicy::deep();
    assert_eq!(policy.threshold_tokens(), 102_400);
    assert_eq!(policy.retain_tokens(), 20_480);
  }
}
