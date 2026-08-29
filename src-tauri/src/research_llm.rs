use super::*;
use crate::research::{validate_research_settings, ResearchLlmSettings};
use crate::research_tools::{tool_openai_schema, ToolSpec};

#[derive(Clone, Debug)]
pub struct LlmToolCall {
  pub id: String,
  pub name: String,
  pub arguments: serde_json::Value,
}

#[derive(Clone, Debug)]
pub struct LlmToolResponse {
  pub content: Option<String>,
  pub tool_calls: Vec<LlmToolCall>,
}

fn research_key_entry() -> Result<keyring::Entry> {
  keyring::Entry::new("PaperNest", "research_api_key").map_err(err)
}

pub(crate) fn research_endpoint(base: &str) -> String {
  let base = base.trim().trim_end_matches('/');
  if base.ends_with("/chat/completions") {
    base.into()
  } else {
    format!("{base}/chat/completions")
  }
}

pub async fn research_llm_completion(
  settings: &ResearchLlmSettings,
  system: &str,
  content: serde_json::Value,
  max_tokens: Option<u32>,
  timeout_secs: u64,
) -> Result<String> {
  let messages = vec![
    serde_json::json!({"role": "system", "content": system}),
    serde_json::json!({"role": "user", "content": content}),
  ];
  let response = research_llm_with_tools(settings, &messages, &[], max_tokens, timeout_secs).await?;
  response
    .content
    .filter(|text| !text.trim().is_empty())
    .ok_or_else(|| "调研 LLM 响应为空".to_string())
}

pub async fn research_llm_with_tools(
  settings: &ResearchLlmSettings,
  messages: &[serde_json::Value],
  tools: &[ToolSpec],
  max_tokens: Option<u32>,
  timeout_secs: u64,
) -> Result<LlmToolResponse> {
  let tool_payload: Vec<serde_json::Value> = tools.iter().map(tool_openai_schema).collect();
  validate_research_settings(settings)?;
  let key = research_key_entry()?.get_password().map_err(|_| "尚未保存调研 API Key，请先在设置中配置".to_string())?;
  if key.trim().is_empty() {
    return Err("尚未保存调研 API Key，请先在设置中配置".into());
  }
  let limit = max_tokens.unwrap_or(settings.max_tokens_per_step);
  let mut request = serde_json::json!({
    "model": settings.model,
    "temperature": 0.2,
    "stream": false,
    "max_tokens": limit,
    "messages": messages,
  });
  if !tools.is_empty() {
    request["tools"] = serde_json::Value::Array(tool_payload);
    request["tool_choice"] = serde_json::json!("auto");
  }
  let endpoint = research_endpoint(&settings.base_url);
  let client = Client::builder()
    .connect_timeout(Duration::from_secs(30))
    .timeout(Duration::from_secs(timeout_secs.max(60)))
    .pool_max_idle_per_host(0)
    .build()
    .map_err(err)?;
  let response = client
    .post(&endpoint)
    .bearer_auth(&key)
    .header("Accept", "application/json")
    .json(&request)
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let value: serde_json::Value = response.json().await.map_err(err)?;
  if !status.is_success() {
    return Err(format!(
      "调研 LLM 请求失败（{}）：{}",
      status,
      value
        .get("error")
        .and_then(|v| v.get("message"))
        .and_then(|v| v.as_str())
        .unwrap_or("请检查地址、模型和 API Key")
    ));
  }
  let mut response = parse_llm_message(&value)?;
  if !tools.is_empty() && response.tool_calls.is_empty() {
    if let Some(content) = &response.content {
      response.tool_calls = parse_json_react_calls(content);
    }
  }
  Ok(response)
}

pub fn parse_json_react_calls(content: &str) -> Vec<LlmToolCall> {
  let Ok(json) = json_from_llm(content) else {
    return vec![];
  };
  let action = json.get("action").and_then(|v| v.as_str()).unwrap_or("");
  match action {
    "finish" => {
      let summary = json
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
      if summary.is_empty() {
        return vec![];
      }
      vec![LlmToolCall {
        id: format!("json-finish-{}", Uuid::new_v4()),
        name: "finish_research".into(),
        arguments: serde_json::json!({ "summary": summary }),
      }]
    }
    "tool" => {
      let name = json.get("name").and_then(|v| v.as_str()).unwrap_or("").trim();
      if name.is_empty() {
        return vec![];
      }
      let arguments = json
        .get("args")
        .cloned()
        .or_else(|| json.get("arguments").cloned())
        .unwrap_or_else(|| serde_json::json!({}));
      vec![LlmToolCall {
        id: format!("json-tool-{}", Uuid::new_v4()),
        name: name.to_string(),
        arguments,
      }]
    }
    _ => vec![],
  }
}

fn parse_llm_message(value: &serde_json::Value) -> Result<LlmToolResponse> {
  let message = value
    .pointer("/choices/0/message")
    .ok_or_else(|| "调研 LLM 响应格式无效".to_string())?;
  let content = message
    .get("content")
    .and_then(|v| {
      if let Some(text) = v.as_str() {
        Some(text.to_string())
      } else if let Some(parts) = v.as_array() {
        parts
          .iter()
          .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
          .map(str::to_string)
          .reduce(|a, b| format!("{a}{b}"))
      } else {
        None
      }
    })
    .filter(|text| !text.trim().is_empty());
  let mut tool_calls = message
    .get("tool_calls")
    .and_then(|v| v.as_array())
    .map(|items| {
      items
        .iter()
        .filter_map(|item| {
          let id = item.get("id").and_then(|v| v.as_str())?.to_string();
          let function = item.get("function")?;
          let name = function.get("name").and_then(|v| v.as_str())?.to_string();
          let args_raw = function.get("arguments").and_then(|v| v.as_str()).unwrap_or("{}");
          let arguments = serde_json::from_str(args_raw).unwrap_or_else(|_| serde_json::json!({}));
          Some(LlmToolCall { id, name, arguments })
        })
        .collect::<Vec<_>>()
    })
    .unwrap_or_default();
  if content.is_none() && tool_calls.is_empty() {
    return Err("调研 LLM 响应为空".into());
  }
  ensure_unique_tool_call_ids(&mut tool_calls);
  Ok(LlmToolResponse {
    content,
    tool_calls,
  })
}

fn ensure_unique_tool_call_ids(calls: &mut Vec<LlmToolCall>) {
  let mut seen = std::collections::HashSet::new();
  for call in calls.iter_mut() {
    if call.id.is_empty() || !seen.insert(call.id.clone()) {
      call.id = format!("call-{}", Uuid::new_v4());
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn json_react_parses_tool_action() {
    let calls = parse_json_react_calls(r#"{"action":"tool","name":"search_library","args":{"query":"agent"}}"#);
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "search_library");
  }
}
