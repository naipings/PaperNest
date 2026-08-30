use crate::search_query::search_tokenize;
use crate::Result;
use reqwest::Client;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct WebBrief {
  pub title: String,
  pub url: String,
  pub excerpt: String,
  pub kind: String,
}

pub async fn search_web_sources(query: &str, limit: i64, from_year: Option<i64>) -> Result<Vec<WebBrief>> {
  let limit = limit.clamp(3, 12);
  let mut out = Vec::new();
  let mut seen = HashSet::new();

  for brief in search_openalex(query, limit, from_year).await.unwrap_or_default() {
    if seen.insert(brief.url.clone()) {
      out.push(brief);
    }
  }
  if out.len() < limit as usize {
    for brief in search_crossref(query, limit - out.len() as i64, from_year)
      .await
      .unwrap_or_default()
    {
      if seen.insert(brief.url.clone()) {
        out.push(brief);
      }
    }
  }
  if out.len() < limit as usize {
    for brief in search_github(query, (limit - out.len() as i64).min(4))
      .await
      .unwrap_or_default()
    {
      if seen.insert(brief.url.clone()) {
        out.push(brief);
      }
    }
  }
  out.truncate(limit as usize);
  Ok(out)
}

/// DuckDuckGo Lite SERP，用于具名来源补链与 llm_web 兜底。
pub async fn search_ddg_lite(query: &str, limit: usize) -> Result<Vec<WebBrief>> {
  let compact = query.trim();
  if compact.len() < 2 {
    return Ok(vec![]);
  }
  let client = http_client()?;
  let response = client
    .post("https://lite.duckduckgo.com/lite/")
    .header("Content-Type", "application/x-www-form-urlencoded")
    .body(format!("q={}", url_encode(compact)))
    .send()
    .await
    .map_err(err)?;
  if !response.status().is_success() {
    return Err(format!("DuckDuckGo Lite 请求失败：{}", response.status()));
  }
  let html = response.text().await.map_err(err)?;
  Ok(parse_ddg_lite_html(&html, limit.clamp(1, 5)))
}

pub async fn resolve_named_web_title(title: &str) -> Option<WebBrief> {
  let compact = title.trim();
  if compact.len() < 4 {
    return None;
  }
  if let Ok(briefs) = search_ddg_lite(compact, 1).await {
    if let Some(brief) = briefs.into_iter().next() {
      return Some(brief);
    }
  }
  search_web_sources(compact, 1, None)
    .await
    .ok()
    .and_then(|items| items.into_iter().next())
}

fn parse_ddg_lite_html(html: &str, limit: usize) -> Vec<WebBrief> {
  let mut out = Vec::new();
  let mut seen = HashSet::new();
  let mut pos = 0usize;
  while out.len() < limit {
    let Some(rel) = html[pos..].find(r#"rel="nofollow""#) else {
      break;
    };
    let chunk = &html[pos + rel..];
    let Some(href_start) = chunk.find("href=\"") else {
      pos += rel + 1;
      continue;
    };
    let href = &chunk[href_start + 6..];
    let Some(href_end) = href.find('"') else {
      break;
    };
    let raw_url = &href[..href_end];
    let url = decode_ddg_result_url(raw_url);
    if !url.starts_with("http") || url.contains("duckduckgo.com") {
      pos += rel + 1;
      continue;
    }
    let tag = &chunk[href_start..];
    let Some(gt) = tag.find('>') else {
      pos += rel + 1;
      continue;
    };
    let inner = &tag[gt + 1..];
    let title = if let Some(close) = inner.find('<') {
      squash(inner[..close].chars().take(160).collect())
    } else {
      url.clone()
    };
    if title.len() < 2 || !seen.insert(url.clone()) {
      pos += rel + 1;
      continue;
    }
    out.push(WebBrief {
      title,
      url,
      excerpt: "DuckDuckGo Lite".into(),
      kind: "ddg".into(),
    });
    pos += rel + href_start + href_end + 1;
  }
  out
}

fn decode_ddg_result_url(raw: &str) -> String {
  if let Some(encoded) = raw.split("uddg=").nth(1).and_then(|part| part.split('&').next()) {
  let mut decoded = String::new();
  let bytes = encoded.as_bytes();
  let mut i = 0usize;
  while i < bytes.len() {
    if bytes[i] == b'%' && i + 2 < bytes.len() {
      if let Ok(byte) = u8::from_str_radix(&encoded[i + 1..i + 3], 16) {
        decoded.push(byte as char);
        i += 3;
        continue;
      }
    }
    decoded.push(bytes[i] as char);
    i += 1;
  }
    if decoded.starts_with("http") {
      return decoded;
    }
  }
  if raw.starts_with("//") {
    return format!("https:{raw}");
  }
  raw.to_string()
}

/// 学术检索词取前 5 个 token：`title_and_abstract.search` 是 AND 语义，词越多越精准，
/// 但整句会把命中降到零。
fn academic_terms(query: &str) -> String {
  search_tokenize(query)
    .into_iter()
    .take(5)
    .collect::<Vec<_>>()
    .join(" ")
}

async fn search_openalex(query: &str, limit: i64, from_year: Option<i64>) -> Result<Vec<WebBrief>> {
  let compact = academic_terms(query);
  if compact.trim().len() < 2 {
    return Ok(vec![]);
  }
  let client = http_client()?;
  // search= 会按引用量给全库热门论文加权，导致跑题；title_and_abstract.search 限定标题与摘要。
  let mut filter = format!("title_and_abstract.search:{compact}");
  if let Some(year) = from_year {
    filter.push_str(&format!(",from_publication_date:{year}-01-01"));
  }
  let url = format!(
    "https://api.openalex.org/works?filter={}&per-page={}",
    url_encode(&filter),
    limit.clamp(3, 10)
  );
  let body: Value = client.get(&url).send().await.map_err(err)?.json().await.map_err(err)?;
  let items = body
    .get("results")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  Ok(items
    .into_iter()
    .filter_map(|item| {
      let title = item.get("display_name")?.as_str()?.trim();
      if title.is_empty() {
        return None;
      }
      let url = item
        .pointer("/primary_location/landing_page_url")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
          item.get("doi")
            .and_then(|v| v.as_str())
            .map(|d| format!("https://doi.org/{d}"))
        })
        .or_else(|| item.get("id").and_then(|v| v.as_str()).map(str::to_string))?;
      let year = item
        .get("publication_year")
        .and_then(|v| v.as_u64())
        .map(|y| y.to_string())
        .unwrap_or_else(|| "?".into());
      let venue = item
        .pointer("/primary_location/source/display_name")
        .and_then(|v| v.as_str())
        .unwrap_or("OpenAlex");
      let excerpt = match openalex_abstract(&item) {
        Some(text) => format!("{venue} · {year} · {text}"),
        None => format!("{venue} · {year}"),
      };
      Some(WebBrief {
        title: title.to_string(),
        url,
        excerpt,
        kind: "openalex".into(),
      })
    })
    .collect())
}

/// OpenAlex 只提供倒排摘要：{词: [位置...]}，按位置还原成句子。
fn openalex_abstract(item: &Value) -> Option<String> {
  let index = item.get("abstract_inverted_index")?.as_object()?;
  let mut words: Vec<(u64, &str)> = Vec::new();
  for (word, positions) in index {
    for position in positions.as_array()? {
      words.push((position.as_u64()?, word.as_str()));
    }
  }
  if words.is_empty() {
    return None;
  }
  words.sort_by_key(|(position, _)| *position);
  let text = words
    .into_iter()
    .map(|(_, word)| word)
    .collect::<Vec<_>>()
    .join(" ");
  Some(squash(text.chars().take(320).collect()))
}

async fn search_crossref(query: &str, limit: i64, from_year: Option<i64>) -> Result<Vec<WebBrief>> {
  let compact = academic_terms(query);
  if compact.trim().len() < 2 {
    return Ok(vec![]);
  }
  let client = http_client()?;
  let mut url = format!(
    "https://api.crossref.org/works?query.bibliographic={}&rows={}",
    url_encode(&compact),
    limit.clamp(2, 8)
  );
  if let Some(year) = from_year {
    url.push_str(&format!("&filter=from-pub-date:{year}-01-01"));
  }
  let body: Value = client
    .get(&url)
    .header("User-Agent", "PaperNest/1.0 (mailto:support@papernest.local)")
    .send()
    .await
    .map_err(err)?
    .json()
    .await
    .map_err(err)?;
  let items = body
    .pointer("/message/items")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  Ok(items
    .into_iter()
    .filter_map(|item| {
      let title = item
        .get("title")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .or_else(|| item.get("title").and_then(|v| v.as_str()))?
        .trim();
      if title.is_empty() {
        return None;
      }
      let url = item
        .get("URL")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .or_else(|| {
          item.get("DOI")
            .and_then(|v| v.as_str())
            .map(|d| format!("https://doi.org/{d}"))
        })?;
      let container = item
        .get("container-title")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.first())
        .and_then(|v| v.as_str())
        .unwrap_or("Crossref");
      let excerpt = item
        .get("abstract")
        .and_then(|v| v.as_str())
        .map(|s| squash(s.chars().take(280).collect()))
        .unwrap_or_else(|| format!("{container} · Crossref 元数据"));
      Some(WebBrief {
        title: title.to_string(),
        url,
        excerpt,
        kind: "crossref".into(),
      })
    })
    .collect())
}

async fn search_github(query: &str, limit: i64) -> Result<Vec<WebBrief>> {
  let compact = search_tokenize(query).join(" ");
  if compact.trim().len() < 2 {
    return Ok(vec![]);
  }
  let client = http_client()?;
  let url = format!(
    "https://api.github.com/search/repositories?q={}&sort=stars&order=desc&per_page={}",
    url_encode(&compact),
    limit.clamp(2, 5)
  );
  let body: Value = client
    .get(&url)
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
    .map_err(err)?
    .json()
    .await
    .map_err(err)?;
  let items = body
    .get("items")
    .and_then(|v| v.as_array())
    .cloned()
    .unwrap_or_default();
  Ok(items
    .into_iter()
    .filter_map(|item| {
      let title = item.get("full_name")?.as_str()?.to_string();
      let url = item.get("html_url")?.as_str()?.to_string();
      let stars = item.get("stargazers_count").and_then(|v| v.as_u64()).unwrap_or(0);
      let excerpt = item
        .get("description")
        .and_then(|v| v.as_str())
        .map(|s| squash(s.chars().take(240).collect()))
        .unwrap_or_else(|| "GitHub 仓库".into());
      Some(WebBrief {
        title: format!("{title} ★{stars}"),
        url,
        excerpt,
        kind: "github".into(),
      })
    })
    .collect())
}

/// 抓取用户给出的网页正文。去掉脚本与标签后按空白折叠，取前 `limit` 字。
pub async fn fetch_url_text(url: &str, limit: usize) -> Result<(String, String)> {
  if !url.starts_with("http://") && !url.starts_with("https://") {
    return Err(format!("不支持的链接：{url}"));
  }
  let response = http_client()?.get(url).send().await.map_err(err)?;
  if !response.status().is_success() {
    return Err(format!("抓取失败 {}：{}", response.status(), url));
  }
  let body = response.text().await.map_err(err)?;
  let title = html_title(&body).unwrap_or_else(|| url.to_string());
  let text: String = squash(strip_html(&body)).chars().take(limit).collect();
  Ok((title, text))
}

fn html_title(body: &str) -> Option<String> {
  let lower = body.to_lowercase();
  let start = lower.find("<title")?;
  let open_end = lower[start..].find('>')? + start + 1;
  let end = lower[open_end..].find("</title>")? + open_end;
  let title = squash(decode_entities(&body[open_end..end]));
  if title.is_empty() {
    None
  } else {
    Some(title)
  }
}

fn strip_html(body: &str) -> String {
  let mut out = String::with_capacity(body.len() / 2);
  let cleaned = drop_blocks(body);
  let mut inside_tag = false;
  for ch in cleaned.chars() {
    match ch {
      '<' => inside_tag = true,
      '>' => {
        inside_tag = false;
        out.push(' ');
      }
      _ if !inside_tag => out.push(ch),
      _ => {}
    }
  }
  decode_entities(&out)
}

fn drop_blocks(body: &str) -> String {
  let mut out = body.to_string();
  for tag in ["script", "style", "noscript"] {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    loop {
      let lower = out.to_lowercase();
      let Some(start) = lower.find(&open) else { break };
      let end = match lower[start..].find(&close) {
        Some(offset) => start + offset + close.len(),
        None => out.len(),
      };
      out.replace_range(start..end, " ");
    }
  }
  out
}

fn decode_entities(text: &str) -> String {
  text
    .replace("&nbsp;", " ")
    .replace("&amp;", "&")
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&quot;", "\"")
    .replace("&#39;", "'")
}

fn http_client() -> Result<Client> {
  Client::builder()
    .timeout(Duration::from_secs(25))
    .user_agent("PaperNest/1.0 (research)")
    .build()
    .map_err(err)
}

fn squash(text: String) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn url_encode(value: &str) -> String {
  value
    .bytes()
    .map(|b| match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
      b' ' => "%20".into(),
      _ => format!("%{b:02X}"),
    })
    .collect()
}

fn err<E: std::fmt::Display>(e: E) -> String {
  e.to_string()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parses_ddg_lite_result_links() {
    let html = r#"<a rel="nofollow" href="https://example.com/report">Gartner Report</a>"#;
    let hits = parse_ddg_lite_html(html, 3);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].url, "https://example.com/report");
    assert_eq!(hits[0].title, "Gartner Report");
  }

  #[test]
  fn decodes_ddg_redirect_urls() {
    let raw = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmit";
    assert_eq!(decode_ddg_result_url(raw), "https://example.com/mit");
  }
}
