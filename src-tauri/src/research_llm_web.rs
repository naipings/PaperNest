use super::*;
use std::collections::HashSet;
use crate::research::{validate_research_settings, ResearchLlmSettings};
use crate::research_llm::research_endpoint;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeWebProvider {
  DashScope,
  Zhipu,
  OpenAiResponses,
}

#[derive(Clone, Debug)]
pub struct LlmWebHit {
  pub title: String,
  pub url: String,
  pub snippet: String,
}

#[derive(Clone, Debug)]
pub struct LlmWebSearchResult {
  pub summary: String,
  pub hits: Vec<LlmWebHit>,
  pub provider: NativeWebProvider,
}

pub fn native_web_search_enabled(settings: &ResearchLlmSettings) -> bool {
  if !settings.allow_web_search {
    return false;
  }
  matches!(settings.llm_native_web_search.as_str(), "off" | "disabled") == false
    && resolve_native_web_provider(settings).is_some()
}

pub fn resolve_native_web_provider(settings: &ResearchLlmSettings) -> Option<NativeWebProvider> {
  match settings.llm_native_web_search.as_str() {
    "off" | "disabled" => None,
    "dashscope" | "qwen" => Some(NativeWebProvider::DashScope),
    "zhipu" | "glm" => Some(NativeWebProvider::Zhipu),
    "openai_responses" | "openai" => Some(NativeWebProvider::OpenAiResponses),
    _ => Some(detect_provider_from_url(&settings.base_url)),
  }
}

fn detect_provider_from_url(base_url: &str) -> NativeWebProvider {
  let lower = base_url.to_lowercase();
  if lower.contains("bigmodel.cn") || lower.contains("zhipu") {
    return NativeWebProvider::Zhipu;
  }
  if lower.contains("openai.com") {
    return NativeWebProvider::OpenAiResponses;
  }
  if lower.contains("dashscope") || lower.contains("aliyuncs.com") {
    return NativeWebProvider::DashScope;
  }
  NativeWebProvider::DashScope
}

fn provider_fallback_chain(settings: &ResearchLlmSettings) -> Vec<NativeWebProvider> {
  let primary = resolve_native_web_provider(settings).unwrap_or(NativeWebProvider::DashScope);
  let mut chain = vec![primary];
  for candidate in [
    NativeWebProvider::DashScope,
    NativeWebProvider::Zhipu,
    NativeWebProvider::OpenAiResponses,
  ] {
    if !chain.contains(&candidate) {
      chain.push(candidate);
    }
  }
  chain
}

pub fn provider_label(provider: NativeWebProvider) -> &'static str {
  match provider {
    NativeWebProvider::DashScope => "百炼/Qwen",
    NativeWebProvider::Zhipu => "智谱 GLM",
    NativeWebProvider::OpenAiResponses => "OpenAI Responses",
  }
}

pub async fn llm_web_search(settings: &ResearchLlmSettings, query: &str) -> Result<LlmWebSearchResult> {
  validate_research_settings(settings)?;
  let key = keyring::Entry::new("PaperNest", "research_api_key")
    .map_err(err)?
    .get_password()
    .map_err(|_| "尚未保存调研 API Key，请先在设置中配置".to_string())?;
  if key.trim().is_empty() {
    return Err("尚未保存调研 API Key，请先在设置中配置".into());
  }
  let compact = query.trim();
  if compact.len() < 2 {
    return Err("llm_web_search 查询过短".into());
  }
  let auto = settings.llm_native_web_search == "auto";
  let chain = if auto {
    provider_fallback_chain(settings)
  } else {
    vec![resolve_native_web_provider(settings).ok_or_else(|| {
      "LLM 内置联网已关闭（llmNativeWebSearch=off）".to_string()
    })?]
  };
  let mut last_error = String::new();
  for provider in chain {
    match run_provider(provider, settings, &key, compact).await {
      Ok(result) => return Ok(result),
      Err(error) => last_error = format!("{provider:?}: {error}"),
    }
  }
  Err(format!(
    "LLM 内置联网检索失败（已尝试多种提供商适配）。最后错误：{last_error}"
  ))
}

async fn run_provider(
  provider: NativeWebProvider,
  settings: &ResearchLlmSettings,
  key: &str,
  query: &str,
) -> Result<LlmWebSearchResult> {
  match provider {
    NativeWebProvider::DashScope => dashscope_search(settings, key, query).await,
    NativeWebProvider::Zhipu => zhipu_search(settings, key, query).await,
    NativeWebProvider::OpenAiResponses => openai_responses_search(settings, key, query).await,
  }
}

fn llm_client(timeout_secs: u64) -> Result<Client> {
  Client::builder()
    .connect_timeout(Duration::from_secs(30))
    .timeout(Duration::from_secs(timeout_secs.max(90)))
    .pool_max_idle_per_host(0)
    .build()
    .map_err(err)
}

fn dashscope_needs_stream(model: &str) -> bool {
  let m = model.to_lowercase();
  m.contains("qwen3.5") || m.contains("omni")
}

async fn dashscope_search(settings: &ResearchLlmSettings, key: &str, query: &str) -> Result<LlmWebSearchResult> {
  let endpoint = research_endpoint(&settings.base_url);
  let client = llm_client(120)?;
  let user_prompt = format!(
    "请联网检索并简要综述以下问题，列出关键事实与来源。问题：{query}"
  );
  let mut body = serde_json::json!({
    "model": settings.model,
    "temperature": 0.2,
    "max_tokens": settings.max_tokens_per_step.min(3000),
    "messages": [
      {"role": "system", "content": "你是文献调研助手。基于联网搜索结果给出简洁中文综述，并保留可核验的事实。"},
      {"role": "user", "content": user_prompt}
    ],
    "enable_search": true,
    "search_options": {
      "forced_search": true,
      "enable_source": true,
      "search_strategy": "agent"
    }
  });
  if dashscope_needs_stream(&settings.model) {
    body["stream"] = serde_json::json!(true);
    let (summary, hits, raw) = dashscope_stream_request(&client, &endpoint, key, &body).await?;
    if summary.trim().is_empty() && hits.is_empty() {
      return Err(parse_api_error(&raw));
    }
    return Ok(finalize_result(LlmWebSearchResult {
      summary,
      hits,
      provider: NativeWebProvider::DashScope,
    }));
  }
  body["stream"] = serde_json::json!(false);
  let response = client
    .post(&endpoint)
    .bearer_auth(key)
    .header("Accept", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let raw: serde_json::Value = response.json().await.map_err(err)?;
  if !status.is_success() {
    let message = parse_api_error(&raw);
    if message.contains("Non-streaming") || message.contains("Web Search") {
      body["stream"] = serde_json::json!(true);
      let (summary, hits, raw) = dashscope_stream_request(&client, &endpoint, key, &body).await?;
      if summary.trim().is_empty() && hits.is_empty() {
        return Err(parse_api_error(&raw));
      }
      return Ok(finalize_result(LlmWebSearchResult {
        summary,
        hits,
        provider: NativeWebProvider::DashScope,
      }));
    }
    return Err(message);
  }
  let summary = extract_message_content(&raw);
  let hits = parse_search_hits(&raw);
  if summary.trim().is_empty() && hits.is_empty() {
    return Err("DashScope 联网响应无正文与来源".into());
  }
  Ok(finalize_result(LlmWebSearchResult {
    summary,
    hits,
    provider: NativeWebProvider::DashScope,
  }))
}

async fn dashscope_stream_request(
  client: &Client,
  endpoint: &str,
  key: &str,
  body: &serde_json::Value,
) -> Result<(String, Vec<LlmWebHit>, serde_json::Value)> {
  let response = client
    .post(endpoint)
    .bearer_auth(key)
    .header("Accept", "text/event-stream")
    .json(body)
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let text = response.text().await.map_err(err)?;
  if !status.is_success() {
    let raw = serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "error": text }));
    return Err(parse_api_error(&raw));
  }
  let mut summary = String::new();
  let mut last_json = serde_json::json!({});
  let mut hits = Vec::new();
  for line in text.lines() {
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
    last_json = chunk.clone();
    if let Some(delta) = chunk
      .pointer("/choices/0/delta/content")
      .and_then(|v| v.as_str())
    {
      summary.push_str(delta);
    }
    if let Some(message) = chunk.pointer("/choices/0/message/content").and_then(|v| v.as_str()) {
      summary = message.to_string();
    }
    let chunk_hits = parse_search_hits(&chunk);
    if !chunk_hits.is_empty() {
      hits = chunk_hits;
    }
  }
  if hits.is_empty() {
    hits = parse_search_hits(&last_json);
  }
  Ok((summary, hits, last_json))
}

fn finalize_result(mut result: LlmWebSearchResult) -> LlmWebSearchResult {
  if result.hits.is_empty() {
    result.hits = extract_hits_from_summary(&result.summary);
  }
  result
}

fn extract_hits_from_summary(summary: &str) -> Vec<LlmWebHit> {
  let mut hits = Vec::new();
  let mut seen = HashSet::new();
  for token in summary.split_whitespace() {
    let trimmed = token.trim_matches(|c: char| {
      matches!(c, '|' | ',' | ')' | '(' | '[' | ']' | '*' | '`' | '"' | '\'' | '。' | '，')
    });
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
      let url = trimmed
        .trim_end_matches(|c: char| {
          !c.is_ascii_alphanumeric() && c != '/' && c != '-' && c != '_' && c != '.' && c != '?' && c != '=' && c != '&' && c != '#'
        })
        .to_string();
      if url.len() > 12 && seen.insert(url.clone()) {
        hits.push(LlmWebHit {
          title: url.clone(),
          url,
          snippet: String::new(),
        });
      }
    }
  }
  let lower = summary.to_lowercase();
  let mut offset = 0usize;
  while let Some(pos) = lower[offset..].find("arxiv:") {
    let start = offset + pos + 6;
    let rest = &summary[start..];
    let id: String = rest
      .chars()
      .take_while(|c| c.is_ascii_digit() || *c == '.')
      .collect();
    if id.contains('.') && id.len() >= 9 {
      let url = format!("https://arxiv.org/abs/{id}");
      if seen.insert(url.clone()) {
        hits.push(LlmWebHit {
          title: format!("arXiv:{id}"),
          url,
          snippet: String::new(),
        });
      }
    }
    offset = start + id.len().max(1);
  }
  hits
}

async fn zhipu_search(settings: &ResearchLlmSettings, key: &str, query: &str) -> Result<LlmWebSearchResult> {
  let endpoint = research_endpoint(&settings.base_url);
  let client = llm_client(120)?;
  let body = serde_json::json!({
    "model": settings.model,
    "temperature": 0.2,
    "max_tokens": settings.max_tokens_per_step.min(3000),
    "messages": [
      {"role": "system", "content": "你是文献调研助手。基于联网搜索结果给出简洁中文综述。"},
      {"role": "user", "content": format!("请联网检索并综述：{query}")}
    ],
    "tools": [{
      "type": "web_search",
      "web_search": {
        "enable": true,
        "search_query": query,
        "search_result": true,
        "count": 5
      }
    }]
  });
  let response = client
    .post(&endpoint)
    .bearer_auth(key)
    .header("Accept", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let raw: serde_json::Value = response.json().await.map_err(err)?;
  if !status.is_success() {
    return Err(parse_api_error(&raw));
  }
  let summary = extract_message_content(&raw);
  let mut hits = parse_zhipu_hits(&raw);
  if hits.is_empty() {
    hits = parse_search_hits(&raw);
  }
  if summary.trim().is_empty() && hits.is_empty() {
    return Err("智谱联网响应无正文与来源".into());
  }
  Ok(finalize_result(LlmWebSearchResult {
    summary,
    hits,
    provider: NativeWebProvider::Zhipu,
  }))
}

async fn openai_responses_search(settings: &ResearchLlmSettings, key: &str, query: &str) -> Result<LlmWebSearchResult> {
  let endpoint = responses_endpoint(&settings.base_url);
  let client = llm_client(120)?;
  let body = serde_json::json!({
    "model": settings.model,
    "input": format!("请联网检索并综述：{query}"),
    "tools": [{"type": "web_search"}]
  });
  let response = client
    .post(&endpoint)
    .bearer_auth(key)
    .header("Accept", "application/json")
    .json(&body)
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let raw: serde_json::Value = response.json().await.map_err(err)?;
  if !status.is_success() {
    return Err(parse_api_error(&raw));
  }
  let summary = extract_responses_text(&raw);
  let hits = parse_openai_responses_hits(&raw);
  if summary.trim().is_empty() && hits.is_empty() {
    return Err("OpenAI Responses 联网响应无正文与来源".into());
  }
  Ok(finalize_result(LlmWebSearchResult {
    summary,
    hits,
    provider: NativeWebProvider::OpenAiResponses,
  }))
}

fn responses_endpoint(base: &str) -> String {
  let base = base.trim().trim_end_matches('/');
  if base.ends_with("/responses") {
    return base.into();
  }
  if base.ends_with("/chat/completions") {
    return format!("{}", base.trim_end_matches("/chat/completions")) + "/responses";
  }
  format!("{base}/responses")
}

fn parse_api_error(raw: &serde_json::Value) -> String {
  raw
    .get("error")
    .and_then(|v| v.get("message").and_then(|m| m.as_str()))
    .or_else(|| raw.get("message").and_then(|m| m.as_str()))
    .or_else(|| raw.get("error").and_then(|e| e.as_str()))
    .unwrap_or("LLM 请求失败")
    .to_string()
}

fn extract_message_content(raw: &serde_json::Value) -> String {
  raw
    .pointer("/choices/0/message/content")
    .and_then(content_to_string)
    .or_else(|| raw.pointer("/output/text").and_then(|v| v.as_str()).map(str::to_string))
    .unwrap_or_default()
}

fn extract_responses_text(raw: &serde_json::Value) -> String {
  if let Some(text) = raw.get("output_text").and_then(|v| v.as_str()) {
    return text.to_string();
  }
  if let Some(items) = raw.get("output").and_then(|v| v.as_array()) {
    let mut parts = Vec::new();
    for item in items {
      if item.get("type").and_then(|v| v.as_str()) == Some("message") {
        if let Some(content) = item.pointer("/content/0/text").and_then(|v| v.as_str()) {
          parts.push(content.to_string());
        }
      }
    }
    if !parts.is_empty() {
      return parts.join("\n");
    }
  }
  extract_message_content(raw)
}

fn content_to_string(value: &serde_json::Value) -> Option<String> {
  if let Some(text) = value.as_str() {
    return Some(text.to_string());
  }
  value.as_array().map(|parts| {
    parts
      .iter()
      .filter_map(|part| part.get("text").and_then(|t| t.as_str()))
      .collect::<Vec<_>>()
      .join("")
  })
}

pub fn parse_search_hits(raw: &serde_json::Value) -> Vec<LlmWebHit> {
  let mut hits = Vec::new();
  for pointer in [
    "/search_info/search_results",
    "/output/search_info/search_results",
    "/choices/0/message/search_info/search_results",
  ] {
    if let Some(items) = raw.pointer(pointer).and_then(|v| v.as_array()) {
      hits.extend(items.iter().filter_map(parse_search_result_item));
      if !hits.is_empty() {
        return dedupe_hits(hits);
      }
    }
  }
  dedupe_hits(hits)
}

fn parse_zhipu_hits(raw: &serde_json::Value) -> Vec<LlmWebHit> {
  let mut hits = Vec::new();
  if let Some(items) = raw.get("web_search").and_then(|v| v.as_array()) {
    for item in items {
      if let Some(hit) = parse_search_result_item(item) {
        hits.push(hit);
      }
    }
  }
  dedupe_hits(hits)
}

fn parse_openai_responses_hits(raw: &serde_json::Value) -> Vec<LlmWebHit> {
  let mut hits = Vec::new();
  if let Some(items) = raw.get("output").and_then(|v| v.as_array()) {
    for item in items {
      if item.get("type").and_then(|v| v.as_str()) != Some("web_search_call") {
        continue;
      }
      if let Some(results) = item.pointer("/action/sources").and_then(|v| v.as_array()) {
        for source in results {
          if let Some(hit) = parse_search_result_item(source) {
            hits.push(hit);
          }
        }
      }
    }
  }
  dedupe_hits(hits)
}

fn parse_search_result_item(item: &serde_json::Value) -> Option<LlmWebHit> {
  let url = item
    .get("url")
    .or_else(|| item.get("link"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .trim()
    .to_string();
  if url.is_empty() || !url.starts_with("http") {
    return None;
  }
  let title = item
    .get("title")
    .or_else(|| item.get("name"))
    .and_then(|v| v.as_str())
    .unwrap_or(&url)
    .trim()
    .to_string();
  let snippet = item
    .get("snippet")
    .or_else(|| item.get("summary"))
    .or_else(|| item.get("content"))
    .or_else(|| item.get("text"))
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .chars()
    .take(320)
    .collect::<String>();
  Some(LlmWebHit {
    title,
    url,
    snippet,
  })
}

fn dedupe_hits(hits: Vec<LlmWebHit>) -> Vec<LlmWebHit> {
  let mut seen = HashSet::new();
  hits
    .into_iter()
    .filter(|hit| seen.insert(hit.url.clone()))
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn detects_dashscope_from_url() {
    assert_eq!(
      detect_provider_from_url("https://dashscope.aliyuncs.com/compatible-mode/v1"),
      NativeWebProvider::DashScope
    );
  }

  #[test]
  fn detects_zhipu_from_url() {
    assert_eq!(
      detect_provider_from_url("https://open.bigmodel.cn/api/paas/v4"),
      NativeWebProvider::Zhipu
    );
  }

  #[test]
  fn parses_dashscope_search_info() {
    let raw = serde_json::json!({
      "search_info": {
        "search_results": [
          {"title": "A", "url": "https://example.com/a", "snippet": "hello"}
        ]
      },
      "choices": [{"message": {"content": "summary text"}}]
    });
    let hits = parse_search_hits(&raw);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].title, "A");
  }

  #[test]
  fn parses_zhipu_web_search_field() {
    let raw = serde_json::json!({
      "web_search": [
        {"title": "B", "link": "https://example.com/b", "content": "world"}
      ],
      "choices": [{"message": {"content": "done"}}]
    });
    let hits = parse_zhipu_hits(&raw);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].url, "https://example.com/b");
  }

  #[test]
  fn extracts_arxiv_ids_from_summary() {
    let hits = extract_hits_from_summary(
      "See arXiv:2504.19678 and arXiv:2501.06322 for surveys.",
    );
    assert_eq!(hits.len(), 2);
    assert!(hits[0].url.contains("2504.19678"));
  }

  #[test]
  fn native_web_off_when_disabled() {
    let settings = ResearchLlmSettings {
      llm_native_web_search: "off".into(),
      allow_web_search: true,
      ..default_test_settings()
    };
    assert!(!native_web_search_enabled(&settings));
  }

  fn default_test_settings() -> ResearchLlmSettings {
    ResearchLlmSettings {
      enabled: true,
      base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1".into(),
      model: "qwen3.5-flash".into(),
      api_key_saved: true,
      allow_web_search: true,
      max_iterations: 8,
      max_tokens_per_step: 2000,
      research_mode: "react".into(),
      research_depth: "standard".into(),
      max_react_rounds: 0,
      max_tool_calls: 0,
      llm_native_web_search: "auto".into(),
    }
  }
}
