use super::*;
use std::collections::HashMap;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineMetadataSettings {
  pub enabled: bool,
  pub provider: String,
  pub mailto: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineMetadataCandidate {
  pub title_en: Option<String>,
  pub authors: Vec<String>,
  pub abstract_en: Option<String>,
  pub venue: Option<String>,
  pub publication_date: Option<String>,
  pub doi: Option<String>,
  pub source_url: Option<String>,
  pub score: Option<f64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OnlineMetadataLookup {
  pub provider: String,
  pub candidates: Vec<OnlineMetadataCandidate>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub cached: Option<bool>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheEntry {
  query_key: String,
  retrieved_at: String,
  lookup: Option<OnlineMetadataLookup>,
  error: Option<String>,
}

fn defaults() -> OnlineMetadataSettings {
  OnlineMetadataSettings { enabled: false, provider: "crossref".into(), mailto: None }
}

pub async fn load(pool: &SqlitePool) -> Result<OnlineMetadataSettings> {
  let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='online_metadata_settings'")
    .fetch_optional(pool)
    .await
    .map_err(err)?;
  let settings = raw
    .as_deref()
    .and_then(|value| serde_json::from_str(value).ok())
    .unwrap_or_else(defaults);
  if raw.is_none() {
    sqlx::query("INSERT INTO settings(key,value) VALUES('online_metadata_settings',?)")
      .bind(serde_json::to_string(&settings).map_err(err)?)
      .execute(pool)
      .await
      .map_err(err)?;
  }
  Ok(settings)
}

pub async fn save(pool: &SqlitePool, mut settings: OnlineMetadataSettings) -> Result<OnlineMetadataSettings> {
  if settings.provider != "crossref" {
    return Err("当前仅支持 Crossref".into());
  }
  settings.mailto = settings.mailto.and_then(|value| {
    let value = value.trim().to_string();
    if value.is_empty() { None } else { Some(value) }
  });
  sqlx::query("INSERT INTO settings(key,value) VALUES('online_metadata_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(serde_json::to_string(&settings).map_err(err)?)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(settings)
}

fn query_key(paper: &Paper) -> String {
  format!(
    "{}|{}",
    paper.doi.as_deref().unwrap_or("").trim().to_lowercase(),
    paper.title_en.trim().to_lowercase()
  )
}

async fn load_cache(pool: &SqlitePool) -> HashMap<String, CacheEntry> {
  let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='online_metadata_cache'")
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
  raw.and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default()
}

async fn save_cache(pool: &SqlitePool, cache: &HashMap<String, CacheEntry>) -> Result<()> {
  sqlx::query("INSERT INTO settings(key,value) VALUES('online_metadata_cache',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(serde_json::to_string(cache).map_err(err)?)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

fn date(message: &serde_json::Value) -> Option<String> {
  for key in ["published-print", "published-online", "issued", "created"] {
    if let Some(parts) = message.pointer(&format!("/{key}/date-parts/0")).and_then(|value| value.as_array()) {
      let year = parts.first()?.as_i64()?;
      let month = parts.get(1).and_then(|value| value.as_i64());
      let day = parts.get(2).and_then(|value| value.as_i64());
      return Some(match (month, day) {
        (Some(month), Some(day)) => format!("{year:04}-{month:02}-{day:02}"),
        (Some(month), None) => format!("{year:04}-{month:02}"),
        _ => year.to_string(),
      });
    }
  }
  None
}

fn strip_markup(value: &str) -> String {
  let mut output = String::new();
  let mut inside = false;
  for character in value.chars() {
    match character {
      '<' => inside = true,
      '>' => inside = false,
      _ if !inside => output.push(character),
      _ => {}
    }
  }
  output
    .replace("&lt;", "<")
    .replace("&gt;", ">")
    .replace("&amp;", "&")
    .split_whitespace()
    .collect::<Vec<_>>()
    .join(" ")
}

fn candidate(message: &serde_json::Value) -> OnlineMetadataCandidate {
  let authors = message
    .get("author")
    .and_then(|value| value.as_array())
    .map(|items| {
      items
        .iter()
        .filter_map(|author| {
          author.get("name").and_then(|value| value.as_str()).map(str::to_owned).or_else(|| {
            let given = author.get("given").and_then(|value| value.as_str()).unwrap_or("");
            let family = author.get("family").and_then(|value| value.as_str()).unwrap_or("");
            let name = format!("{given} {family}").trim().to_string();
            if name.is_empty() { None } else { Some(name) }
          })
        })
        .collect()
    })
    .unwrap_or_default();
  let doi = message.get("DOI").and_then(|value| value.as_str()).map(str::to_owned);
  OnlineMetadataCandidate {
    title_en: message.pointer("/title/0").and_then(|value| value.as_str()).map(str::to_owned),
    authors,
    abstract_en: message
      .get("abstract")
      .and_then(|value| value.as_str())
      .map(strip_markup)
      .filter(|value| !value.is_empty()),
    venue: message.pointer("/container-title/0").and_then(|value| value.as_str()).map(str::to_owned),
    publication_date: date(message),
    source_url: message
      .get("URL")
      .and_then(|value| value.as_str())
      .map(str::to_owned)
      .or_else(|| doi.as_ref().map(|value| format!("https://doi.org/{value}"))),
    doi,
    score: message.get("score").and_then(|value| value.as_f64()),
  }
}

fn user_agent(mailto: Option<&str>) -> String {
  match mailto.filter(|value| !value.is_empty()) {
    Some(mailto) => format!("PaperNest/0.1 (+mailto:{mailto})"),
    None => "PaperNest/0.1".into(),
  }
}

fn normalize_doi(value: &str) -> String {
  value
    .trim()
    .trim_start_matches("https://doi.org/")
    .trim_start_matches("http://doi.org/")
    .to_string()
}

async fn crossref_get(client: &Client, mut url: reqwest::Url, mailto: Option<&str>) -> Result<reqwest::Response> {
  if let Some(mailto) = mailto.filter(|value| !value.is_empty()) {
    url.query_pairs_mut().append_pair("mailto", mailto);
  }
  let mut delay = Duration::from_secs(1);
  for attempt in 0..3 {
    let response = client.get(url.clone()).send().await.map_err(err)?;
    if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
      if attempt < 2 {
        tokio::time::sleep(delay).await;
        delay *= 2;
        continue;
      }
      return Err("Crossref 请求过于频繁，请稍后重试".into());
    }
    return Ok(response);
  }
  Err("Crossref 请求失败".into())
}

async fn fetch_messages(client: &Client, paper: &Paper, mailto: Option<&str>) -> Result<Vec<serde_json::Value>> {
  if let Some(doi) = paper.doi.as_deref().filter(|value| !value.trim().is_empty()) {
    let mut url = reqwest::Url::parse("https://api.crossref.org/v1/works/").map_err(err)?;
    url
      .path_segments_mut()
      .map_err(|_| "无法构造 Crossref DOI 地址".to_string())?
      .pop_if_empty()
      .push(&normalize_doi(doi));
    let response = crossref_get(client, url, mailto).await?;
    if !response.status().is_success() {
      return Err(format!("Crossref 请求失败：{}", response.status()));
    }
    let body = response.json::<serde_json::Value>().await.map_err(err)?;
    let message = body
      .get("message")
      .cloned()
      .ok_or_else(|| "Crossref 未返回 message".to_string())?;
    return Ok(vec![message]);
  }
  let query = paper.title_en.chars().take(500).collect::<String>();
  if query.trim().len() < 3 {
    return Err("请先填写 DOI 或至少三个字符的英文标题".into());
  }
  let mut url = reqwest::Url::parse("https://api.crossref.org/v1/works").map_err(err)?;
  {
    let mut pairs = url.query_pairs_mut();
    pairs.append_pair("query.bibliographic", query.as_str());
    pairs.append_pair("rows", "5");
  }
  let response = crossref_get(client, url, mailto).await?;
  if !response.status().is_success() {
    return Err(format!("Crossref 请求失败：{}", response.status()));
  }
  response
    .json::<serde_json::Value>()
    .await
    .map_err(err)?
    .pointer("/message/items")
    .and_then(|value| value.as_array())
    .cloned()
    .ok_or_else(|| "Crossref 未返回候选论文".to_string())
}

fn lookup_from_messages(messages: &[serde_json::Value]) -> OnlineMetadataLookup {
  OnlineMetadataLookup {
    provider: "crossref".into(),
    candidates: messages.iter().map(candidate).filter(|value| value.title_en.is_some()).collect(),
    cached: None,
  }
}

pub async fn lookup(pool: &SqlitePool, paper_id: &str) -> Result<OnlineMetadataLookup> {
  let settings = load(pool).await?;
  if !settings.enabled {
    return Err("在线元数据补全尚未启用".into());
  }
  let paper = row_paper(
    sqlx::query("SELECT * FROM papers WHERE id=? AND deleted_at IS NULL")
      .bind(paper_id)
      .fetch_one(pool)
      .await
      .map_err(err)?,
  )?;
  let key = query_key(&paper);
  let mut cache = load_cache(pool).await;
  if let Some(entry) = cache.get(paper_id).filter(|entry| entry.query_key == key) {
    if let Some(error) = &entry.error {
      return Err(error.clone());
    }
    if let Some(mut lookup) = entry.lookup.clone() {
      lookup.cached = Some(true);
      return Ok(lookup);
    }
  }

  let client = Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent(user_agent(settings.mailto.as_deref()))
    .build()
    .map_err(err)?;
  let result = async {
    let messages = fetch_messages(&client, &paper, settings.mailto.as_deref()).await?;
    Ok(lookup_from_messages(&messages))
  }
  .await;

  let entry = CacheEntry {
    query_key: key,
    retrieved_at: Utc::now().to_rfc3339(),
    lookup: result.as_ref().ok().cloned(),
    error: result.as_ref().err().cloned(),
  };
  cache.insert(paper_id.to_string(), entry);
  save_cache(pool, &cache).await?;
  result
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn strip_markup_removes_tags() {
    assert_eq!(
      strip_markup("<jats:p>Hello <i>world</i></jats:p>"),
      "Hello world"
    );
  }

  #[test]
  fn date_prefers_published_print() {
    let message = serde_json::json!({
      "published-print": { "date-parts": [[2024, 3, 15]] }
    });
    assert_eq!(date(&message).as_deref(), Some("2024-03-15"));
  }

  #[test]
  fn candidate_maps_core_fields() {
    let message = serde_json::json!({
      "title": ["Attention Is All You Need"],
      "author": [{ "given": "Ashish", "family": "Vaswani" }],
      "container-title": ["NeurIPS"],
      "published-print": { "date-parts": [[2017]] },
      "DOI": "10.5555/3295222.3295349",
      "URL": "https://example.org/paper"
    });
    let item = candidate(&message);
    assert_eq!(item.title_en.as_deref(), Some("Attention Is All You Need"));
    assert_eq!(item.authors, vec!["Ashish Vaswani"]);
    assert_eq!(item.venue.as_deref(), Some("NeurIPS"));
    assert_eq!(item.publication_date.as_deref(), Some("2017"));
    assert_eq!(item.doi.as_deref(), Some("10.5555/3295222.3295349"));
  }
}
