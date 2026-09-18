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
  pub finish_reason: Option<String>,
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

/// Kimi / Moonshot 在阿里云 MaaS 上只允许固定 sampling 参数；传自定义 temperature 会 400。
pub(crate) fn model_rejects_custom_temperature(model: &str) -> bool {
  let m = model.to_lowercase();
  m.contains("kimi") || m.contains("moonshot")
}

pub(crate) fn attach_temperature(request: &mut serde_json::Value, model: &str, temperature: f64) {
  if !model_rejects_custom_temperature(model) {
    request["temperature"] = serde_json::json!(temperature);
  }
}

/// 按输出 token 预算估算墙钟超时：TTFT + ~20 tok/s，上限 20 分钟。
pub(crate) fn adaptive_timeout_secs(max_tokens: u32, floor: u64) -> u64 {
  let estimated = 90u64.saturating_add(((max_tokens as u64) + 19) / 20);
  floor.max(estimated).min(1_200)
}

pub(crate) fn estimate_text_tokens(text: &str) -> u32 {
  ((text.chars().count() as u32) / 4).max(1)
}

fn format_reqwest_error(e: &reqwest::Error) -> String {
  let mut msg = e.to_string();
  let mut source = std::error::Error::source(e);
  while let Some(err) = source {
    let part = err.to_string();
    if !part.is_empty() && !msg.contains(&part) {
      msg = format!("{msg}: {part}");
    }
    source = std::error::Error::source(err);
  }
  msg
}

fn research_http_client(timeout_secs: u64) -> Result<Client> {
  Client::builder()
    .connect_timeout(Duration::from_secs(30))
    .timeout(Duration::from_secs(timeout_secs.max(60)))
    .tcp_keepalive(Duration::from_secs(30))
    .pool_max_idle_per_host(0)
    .build()
    .map_err(err)
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

/// 长文写作：流式读取，返回正文与 finish_reason（length/stop）。
pub async fn research_llm_completion_streamed(
  settings: &ResearchLlmSettings,
  system: &str,
  content: serde_json::Value,
  max_tokens: u32,
  timeout_secs: u64,
) -> Result<(String, Option<String>)> {
  let messages = vec![
    serde_json::json!({"role": "system", "content": system}),
    serde_json::json!({"role": "user", "content": content}),
  ];
  let response = research_llm_text_stream(settings, &messages, max_tokens, timeout_secs).await?;
  let text = response
    .content
    .filter(|t| !t.trim().is_empty())
    .ok_or_else(|| "调研 LLM 响应为空".to_string())?;
  Ok((text, response.finish_reason))
}

pub async fn research_llm_with_tools(
  settings: &ResearchLlmSettings,
  messages: &[serde_json::Value],
  tools: &[ToolSpec],
  max_tokens: Option<u32>,
  timeout_secs: u64,
) -> Result<LlmToolResponse> {
  let limit = max_tokens.unwrap_or(settings.max_tokens_per_step);
  // 无工具的长输出走流式，避免网关在整段生成完成前掐断空闲连接。
  if tools.is_empty() && limit >= 2_500 {
    return research_llm_text_stream(settings, messages, limit, timeout_secs).await;
  }
  research_llm_json_once(settings, messages, tools, limit, timeout_secs).await
}

async fn research_llm_json_once(
  settings: &ResearchLlmSettings,
  messages: &[serde_json::Value],
  tools: &[ToolSpec],
  limit: u32,
  timeout_secs: u64,
) -> Result<LlmToolResponse> {
  let tool_payload: Vec<serde_json::Value> = tools.iter().map(tool_openai_schema).collect();
  validate_research_settings(settings)?;
  let key = research_key_entry()?.get_password().map_err(|_| "尚未保存调研 API Key，请先在设置中配置".to_string())?;
  if key.trim().is_empty() {
    return Err("尚未保存调研 API Key，请先在设置中配置".into());
  }
  let effective_timeout = adaptive_timeout_secs(limit, timeout_secs);
  let mut request = serde_json::json!({
    "model": settings.model,
    "stream": false,
    "max_tokens": limit,
    "messages": messages,
  });
  attach_temperature(&mut request, &settings.model, 0.2);
  if !tools.is_empty() {
    request["tools"] = serde_json::Value::Array(tool_payload);
    request["tool_choice"] = serde_json::json!("auto");
  }
  let endpoint = research_endpoint(&settings.base_url);
  let response = send_with_retries(&endpoint, &key, &request, effective_timeout, false).await?;
  let status = response.status();
  let value: serde_json::Value = response.json().await.map_err(|e| format_reqwest_error(&e))?;
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
  let finish_reason = value
    .pointer("/choices/0/finish_reason")
    .and_then(|v| v.as_str())
    .map(str::to_string);
  let mut parsed = parse_llm_message(&value)?;
  parsed.finish_reason = finish_reason;
  if !tools.is_empty() && parsed.tool_calls.is_empty() {
    if let Some(content) = &parsed.content {
      parsed.tool_calls = parse_json_react_calls(content);
    }
  }
  Ok(parsed)
}

async fn research_llm_text_stream(
  settings: &ResearchLlmSettings,
  messages: &[serde_json::Value],
  limit: u32,
  timeout_secs: u64,
) -> Result<LlmToolResponse> {
  validate_research_settings(settings)?;
  let key = research_key_entry()?.get_password().map_err(|_| "尚未保存调研 API Key，请先在设置中配置".to_string())?;
  if key.trim().is_empty() {
    return Err("尚未保存调研 API Key，请先在设置中配置".into());
  }
  let effective_timeout = adaptive_timeout_secs(limit, timeout_secs.max(180));
  let mut request = serde_json::json!({
    "model": settings.model,
    "stream": true,
    "max_tokens": limit,
    "messages": messages,
  });
  attach_temperature(&mut request, &settings.model, 0.2);
  let endpoint = research_endpoint(&settings.base_url);
  let response = send_with_retries(&endpoint, &key, &request, effective_timeout, true).await?;
  let status = response.status();
  if !status.is_success() {
    let value: serde_json::Value = response.json().await.map_err(|e| format_reqwest_error(&e))?;
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
  let (content, finish_reason) = read_sse_completion(response).await?;
  if content.trim().is_empty() {
    return Err("调研 LLM 流式响应为空".into());
  }
  Ok(LlmToolResponse {
    content: Some(content),
    tool_calls: vec![],
    finish_reason,
  })
}

async fn send_with_retries(
  endpoint: &str,
  key: &str,
  request: &serde_json::Value,
  timeout_secs: u64,
  stream: bool,
) -> Result<reqwest::Response> {
  // 超时不宜连撞 5 次：每次都可能烧满 timeout。传输抖动可多退；纯超时最多再试 1 次。
  const MAX_TRANSPORT: u32 = 4;
  const MAX_TIMEOUT: u32 = 2;
  let mut transport_fails = 0u32;
  let mut timeout_fails = 0u32;
  let accept = if stream {
    "text/event-stream"
  } else {
    "application/json"
  };
  loop {
    let client = research_http_client(timeout_secs)?;
    match client
      .post(endpoint)
      .bearer_auth(key)
      .header("Accept", accept)
      .json(request)
      .send()
      .await
    {
      Ok(resp) => return Ok(resp),
      Err(e) if e.is_timeout() && timeout_fails + 1 < MAX_TIMEOUT => {
        timeout_fails += 1;
        tokio::time::sleep(Duration::from_secs(3)).await;
        continue;
      }
      Err(e) if (e.is_connect() || e.is_request()) && transport_fails + 1 < MAX_TRANSPORT => {
        transport_fails += 1;
        tokio::time::sleep(Duration::from_secs(2u64.pow(transport_fails.min(4)))).await;
        continue;
      }
      Err(e) => {
        return Err(format!(
          "调研 LLM 请求发送失败（传输重试 {transport_fails}，超时重试 {timeout_fails}）：{}",
          format_reqwest_error(&e)
        ));
      }
    }
  }
}

async fn read_sse_completion(mut response: reqwest::Response) -> Result<(String, Option<String>)> {
  let mut buffer = String::new();
  let mut content = String::new();
  let mut finish_reason: Option<String> = None;
  while let Some(chunk) = response.chunk().await.map_err(|e| format_reqwest_error(&e))? {
    buffer.push_str(&String::from_utf8_lossy(&chunk));
    while let Some(idx) = buffer.find('\n') {
      let mut line = buffer[..idx].to_string();
      buffer = buffer[idx + 1..].to_string();
      if line.ends_with('\r') {
        line.pop();
      }
      let line = line.trim();
      if !line.starts_with("data:") {
        continue;
      }
      let payload = line.trim_start_matches("data:").trim();
      if payload.is_empty() || payload == "[DONE]" {
        continue;
      }
      let Ok(chunk) = serde_json::from_str::<serde_json::Value>(payload) else {
        continue;
      };
      if let Some(delta) = chunk.pointer("/choices/0/delta/content").and_then(|v| v.as_str()) {
        content.push_str(delta);
      } else if let Some(message) = chunk.pointer("/choices/0/message/content").and_then(|v| v.as_str()) {
        content = message.to_string();
      }
      if let Some(reason) = chunk.pointer("/choices/0/finish_reason").and_then(|v| v.as_str()) {
        if !reason.is_empty() && reason != "null" {
          finish_reason = Some(reason.to_string());
        }
      }
    }
  }
  if !buffer.trim().is_empty() {
    let line = buffer.trim();
    if line.starts_with("data:") {
      let payload = line.trim_start_matches("data:").trim();
      if payload != "[DONE]" {
        if let Ok(chunk) = serde_json::from_str::<serde_json::Value>(payload) {
          if let Some(delta) = chunk.pointer("/choices/0/delta/content").and_then(|v| v.as_str()) {
            content.push_str(delta);
          }
          if let Some(reason) = chunk.pointer("/choices/0/finish_reason").and_then(|v| v.as_str()) {
            if !reason.is_empty() && reason != "null" {
              finish_reason = Some(reason.to_string());
            }
          }
        }
      }
    }
  }
  Ok((content, finish_reason))
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
    finish_reason: None,
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

  #[test]
  fn kimi_omits_temperature() {
    let mut request = serde_json::json!({"model": "kimi/kimi-k3"});
    attach_temperature(&mut request, "kimi/kimi-k3", 0.2);
    assert!(request.get("temperature").is_none());
    let mut moonshot = serde_json::json!({"model": "moonshot-v1-8k"});
    attach_temperature(&mut moonshot, "moonshot-v1-8k", 0.2);
    assert!(moonshot.get("temperature").is_none());
  }

  #[test]
  fn qwen_keeps_temperature() {
    let mut request = serde_json::json!({"model": "qwen3.8-flash"});
    attach_temperature(&mut request, "qwen3.8-flash", 0.2);
    assert_eq!(request["temperature"], 0.2);
  }

  #[test]
  fn adaptive_timeout_grows_with_max_tokens() {
    assert!(adaptive_timeout_secs(2_000, 120) >= 120);
    assert!(adaptive_timeout_secs(30_000, 300) >= 600);
    assert_eq!(adaptive_timeout_secs(30_000, 300), 1_200.min(90 + 30_000 / 20));
  }
}
