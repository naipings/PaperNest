use serde::{Deserialize, Serialize};

use crate::research::ResearchLlmSettings;
use crate::research_dsh_compact::{estimate_openai_message_tokens, CompactionPolicy};
use crate::research_dsh_derive;
use crate::research_react::react_system_prompt;
use crate::research_tools::{react_tool_catalog, tool_openai_schema};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchContextBucket {
  pub id: String,
  pub label: String,
  pub tokens: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchContextUsage {
  pub context_window: u64,
  pub threshold_ratio: f64,
  pub used_tokens: u64,
  pub percent_full: f64,
  pub near_compaction: bool,
  pub buckets: Vec<ResearchContextBucket>,
}

fn message_content_text(message: &serde_json::Value) -> String {
  message
    .get("content")
    .and_then(|value| {
      if let Some(text) = value.as_str() {
        return Some(text.to_string());
      }
      None
    })
    .unwrap_or_default()
}

fn tools_tokens(settings: &ResearchLlmSettings) -> u64 {
  let tools = react_tool_catalog(settings);
  let payload: Vec<serde_json::Value> = tools.iter().map(tool_openai_schema).collect();
  let chars = serde_json::to_string(&payload).unwrap_or_default().len();
  ((chars as u64) / 4).max(1)
}

fn bucket_tokens(messages: &[serde_json::Value]) -> u64 {
  if messages.is_empty() {
    return 0;
  }
  estimate_openai_message_tokens(messages)
}

pub(crate) fn compute_context_usage(
  settings: &ResearchLlmSettings,
  events: &[serde_json::Value],
  turn_count: usize,
  draft_question: Option<&str>,
  draft_attachment_chars: u64,
  preview_followup: bool,
) -> ResearchContextUsage {
  let effective_turns = if preview_followup {
    turn_count + 1
  } else {
    turn_count
  };
  let policy = CompactionPolicy::for_session(effective_turns.max(1));
  let context_window = policy.context_window;

  let mut messages = research_dsh_derive::derive_openai_messages(events);
  if !messages.is_empty() {
    messages[0] = serde_json::json!({
      "role": "system",
      "content": react_system_prompt(),
    });
  }

  let system_tokens = bucket_tokens(&[serde_json::json!({
    "role": "system",
    "content": react_system_prompt(),
  })]);
  let tools_token_count = tools_tokens(settings);

  let mut compacted_tokens = 0u64;
  let mut conversation_tokens = 0u64;
  for message in messages.iter().skip(1) {
    let text = message_content_text(message);
    let tokens = bucket_tokens(&[message.clone()]);
    if message.get("role").and_then(|value| value.as_str()) == Some("user")
      && text.contains("<compacted-summary>")
    {
      compacted_tokens += tokens;
    } else {
      conversation_tokens += tokens;
    }
  }

  let draft_text = draft_question.unwrap_or("").trim();
  let draft_tokens = if draft_text.is_empty() && draft_attachment_chars == 0 {
    0
  } else {
    let chars = draft_text.len() as u64 + draft_attachment_chars;
    (chars / 4).max(if chars > 0 { 1 } else { 0 })
  };

  let used_tokens = system_tokens + tools_token_count + compacted_tokens + conversation_tokens + draft_tokens;
  let percent_full = (used_tokens as f64 / context_window as f64) * 100.0;
  let near_compaction = used_tokens >= policy.threshold_tokens();

  let buckets = vec![
    ResearchContextBucket {
      id: "system".into(),
      label: "系统提示".into(),
      tokens: system_tokens,
    },
    ResearchContextBucket {
      id: "tools".into(),
      label: "工具定义".into(),
      tokens: tools_token_count,
    },
    ResearchContextBucket {
      id: "compacted".into(),
      label: "已压缩摘要".into(),
      tokens: compacted_tokens,
    },
    ResearchContextBucket {
      id: "conversation".into(),
      label: "对话与工具结果".into(),
      tokens: conversation_tokens,
    },
    ResearchContextBucket {
      id: "draft".into(),
      label: "未发送追问".into(),
      tokens: draft_tokens,
    },
  ];

  ResearchContextUsage {
    context_window,
    threshold_ratio: policy.threshold_ratio,
    used_tokens,
    percent_full,
    near_compaction,
    buckets,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn default_settings() -> ResearchLlmSettings {
    ResearchLlmSettings {
      enabled: true,
      base_url: "https://example.com".into(),
      model: "test".into(),
      api_key_saved: false,
      allow_web_search: false,
      max_iterations: 8,
      max_tokens_per_step: 2000,
      report_max_tokens: 12_000,
      research_mode: "react".into(),
      research_depth: "standard".into(),
      max_react_rounds: 0,
      max_tool_calls: 0,
      llm_native_web_search: "off".into(),
    }
  }

  #[test]
  fn empty_events_has_system_and_tools_only() {
    let usage = compute_context_usage(&default_settings(), &[], 0, None, 0, false);
    assert!(usage.used_tokens > 0);
    assert_eq!(usage.buckets[0].id, "system");
    assert!(usage.buckets[1].tokens > 0);
    assert_eq!(usage.buckets[4].tokens, 0);
  }

  #[test]
  fn compacted_message_goes_to_compacted_bucket() {
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
          "content": [{ "type": "text", "text": "<compacted-summary>\nold context\n</compacted-summary>" }],
          "source": { "kind": "plugin" }
        }
      }),
      serde_json::json!({
        "seq": 3,
        "type": "user/message",
        "surfaceOp": "append",
        "data": {
          "role": "user",
          "content": [{ "type": "text", "text": "追问" }],
          "source": { "kind": "user" }
        }
      }),
    ];
    let usage = compute_context_usage(&default_settings(), &events, 1, None, 0, false);
    assert!(usage.buckets.iter().find(|b| b.id == "compacted").unwrap().tokens > 0);
    assert!(usage.buckets.iter().find(|b| b.id == "conversation").unwrap().tokens > 0);
  }

  #[test]
  fn draft_question_adds_draft_bucket() {
    let usage = compute_context_usage(&default_settings(), &[], 1, Some("继续展开"), 0, true);
    assert!(usage.buckets.iter().find(|b| b.id == "draft").unwrap().tokens > 0);
    assert_eq!(usage.threshold_ratio, 0.65);
  }
}
