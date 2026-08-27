use super::*;
use std::collections::{HashMap, HashSet};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS radar_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS radar_papers (
  arxiv_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  abstract_text TEXT,
  authors_json TEXT NOT NULL DEFAULT '[]',
  primary_category TEXT,
  categories_json TEXT NOT NULL DEFAULT '[]',
  published_date TEXT,
  abs_url TEXT,
  alphaxiv_url TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_ai_summaries (
  arxiv_id TEXT PRIMARY KEY,
  title TEXT,
  summary_text TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  captured_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_date TEXT NOT NULL,
  arxiv_id TEXT NOT NULL,
  feed TEXT NOT NULL,
  rank INTEGER,
  upvotes INTEGER,
  UNIQUE (snapshot_date, arxiv_id, feed)
);
CREATE INDEX IF NOT EXISTS idx_radar_snapshots_date ON radar_snapshots(snapshot_date, feed);
CREATE TABLE IF NOT EXISTS radar_digests (
  anchor_date TEXT NOT NULL,
  kind TEXT NOT NULL,
  window_start TEXT,
  window_end TEXT,
  coverage_days INTEGER NOT NULL DEFAULT 0,
  model TEXT,
  content_json TEXT NOT NULL,
  paper_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (anchor_date, kind)
);
CREATE TABLE IF NOT EXISTS radar_explanations (
  arxiv_id TEXT PRIMARY KEY,
  content_json TEXT NOT NULL,
  model TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_user_state (
  arxiv_id TEXT PRIMARY KEY,
  later INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS radar_run_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  feeds_json TEXT NOT NULL DEFAULT '[]',
  papers_added INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS radar_embeddings (
  arxiv_id TEXT PRIMARY KEY,
  text_hash TEXT NOT NULL,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarSettings {
  pub enabled: bool,
  pub mailto: Option<String>,
  pub categories: Vec<String>,
  #[serde(default)]
  pub keywords: Vec<String>,
  #[serde(default = "default_true")]
  pub default_filter_enabled: bool,
  pub hot_limit: i64,
  pub new_limit: i64,
  pub retain_days: i64,
}

fn default_true() -> bool {
  true
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarCard {
  pub arxiv_id: String,
  pub title: String,
  pub abstract_text: Option<String>,
  pub ai_summary: Option<String>,
  pub authors: Vec<String>,
  pub categories: Vec<String>,
  pub primary_category: Option<String>,
  pub published_date: Option<String>,
  pub abs_url: Option<String>,
  pub alphaxiv_url: Option<String>,
  pub feed: String,
  pub rank: Option<i64>,
  pub upvotes: Option<i64>,
  pub snapshot_date: String,
  pub in_library: bool,
  pub later: bool,
  pub hidden: bool,
  #[serde(default)]
  pub topics: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarFeedPage {
  pub cards: Vec<RadarCard>,
  pub total_count: usize,
  pub interest_filter_applied: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarFetchResult {
  pub snapshot_date: String,
  pub hot_count: i64,
  pub new_count: i64,
  #[serde(default)]
  pub interest_count: i64,
  pub errors: Vec<String>,
  pub status: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarWeekHot {
  pub window_start: String,
  pub window_end: String,
  pub coverage_days: i64,
  pub categories: Vec<RadarWeekCategory>,
  pub persistent: Vec<RadarPersistentPaper>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarWeekCategory {
  pub category: String,
  pub paper_count: i64,
  pub max_upvotes: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarPersistentPaper {
  pub arxiv_id: String,
  pub title: String,
  pub days: i64,
  pub peak_upvotes: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarDigest {
  pub anchor_date: String,
  pub kind: String,
  pub window_start: Option<String>,
  pub window_end: Option<String>,
  pub coverage_days: i64,
  pub overview: String,
  pub clusters: Vec<RadarDigestCluster>,
  pub paper_count: i64,
  pub model: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarDigestCluster {
  pub theme: String,
  pub summary: String,
  pub papers: Vec<RadarDigestPaperRef>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarDigestPaperRef {
  pub id: String,
  pub title: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarExplanation {
  pub arxiv_id: String,
  #[serde(default)]
  pub title_en: Option<String>,
  #[serde(default)]
  pub title_zh: Option<String>,
  #[serde(default)]
  pub abstract_en: Option<String>,
  #[serde(default)]
  pub abstract_zh: Option<String>,
  #[serde(default)]
  pub summary_zh: Option<String>,
  pub problem: String,
  pub method: String,
  pub finding: String,
  pub highlight: String,
  pub model: Option<String>,
}

fn explanation_is_rich(value: &RadarExplanation) -> bool {
  let has_title = value
    .title_zh
    .as_deref()
    .map(str::trim)
    .filter(|v| !v.is_empty())
    .is_some();
  let has_summary = value
    .summary_zh
    .as_deref()
    .map(str::trim)
    .filter(|v| !v.is_empty())
    .is_some();
  let has_abstract_zh = value
    .abstract_zh
    .as_deref()
    .map(str::trim)
    .filter(|v| !v.is_empty())
    .is_some();
  // 完整解读须含中文摘要；旧「极简速读」缓存会自动重生成
  has_title && has_summary && has_abstract_zh && value.problem.trim().chars().count() >= 12
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarRecommendResult {
  pub strategy: String,
  pub window_days: i64,
  pub coverage_days: i64,
  pub items: Vec<RadarRecommendItem>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarRecommendItem {
  pub card: RadarCard,
  pub reasons: Vec<String>,
  pub score: f64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RadarImportResult {
  pub paper: Paper,
  pub downloaded_pdf: bool,
  pub already_in_library: bool,
}

fn default_settings() -> RadarSettings {
  RadarSettings {
    enabled: false,
    mailto: None,
    categories: vec![
      "cs.LG".into(),
      "cs.CL".into(),
      "cs.CV".into(),
      "cs.AI".into(),
      "cs.IR".into(),
    ],
    keywords: vec![],
    default_filter_enabled: true,
    hot_limit: 30,
    new_limit: 100,
    retain_days: 90,
  }
}

const NEW_WINDOW_DAYS: i64 = 2;
const INTEREST_WINDOW_DAYS: i64 = 3;
const INTEREST_PER_KEYWORD: i64 = 50;
const INTEREST_TOTAL_CAP: usize = 150;

pub fn category_catalog() -> Vec<(String, String)> {
  vec![
    ("cs.AI", "人工智能"),
    ("cs.CL", "计算与语言"),
    ("cs.CV", "计算机视觉"),
    ("cs.LG", "机器学习"),
    ("cs.IR", "信息检索"),
    ("cs.NE", "神经与进化计算"),
    ("cs.RO", "机器人"),
    ("cs.SE", "软件工程"),
    ("cs.CR", "密码学与安全"),
    ("cs.DB", "数据库"),
    ("cs.DC", "分布式计算"),
    ("cs.HC", "人机交互"),
    ("cs.MA", "多智能体"),
    ("cs.MM", "多媒体"),
    ("cs.NI", "网络"),
    ("cs.PL", "编程语言"),
    ("cs.SI", "社会与信息网络"),
    ("cs.SY", "系统与控制"),
  ]
  .into_iter()
  .map(|(a, b)| (a.into(), b.into()))
  .collect()
}

async fn open_radar_pool(library_dir: &Path) -> Result<SqlitePool> {
  let db_path = library_dir.join("radar.db");
  let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.to_string_lossy()))
    .map_err(err)?
    .create_if_missing(true);
  let pool = SqlitePoolOptions::new().max_connections(3).connect_with(options).await.map_err(err)?;
  for statement in SCHEMA.split(';').map(str::trim).filter(|s| !s.is_empty()) {
    sqlx::query(statement).execute(&pool).await.map_err(err)?;
  }
  Ok(pool)
}

async fn load_settings(pool: &SqlitePool) -> Result<RadarSettings> {
  let raw: Option<String> = sqlx::query_scalar("SELECT value FROM radar_meta WHERE key='settings'")
    .fetch_optional(pool)
    .await
    .map_err(err)?;
  Ok(raw
    .as_deref()
    .and_then(|value| serde_json::from_str(value).ok())
    .unwrap_or_else(default_settings))
}

async fn save_settings(pool: &SqlitePool, mut settings: RadarSettings) -> Result<RadarSettings> {
  settings.mailto = settings.mailto.and_then(|value| {
    let value = value.trim().to_string();
    if value.is_empty() { None } else { Some(value) }
  });
  settings.categories = settings
    .categories
    .into_iter()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .collect();
  if settings.categories.is_empty() {
    settings.categories = default_settings().categories;
  }
  settings.keywords = settings
    .keywords
    .into_iter()
    .map(|value| value.trim().to_string())
    .filter(|value| !value.is_empty())
    .collect();
  settings.hot_limit = settings.hot_limit.clamp(5, 100);
  settings.new_limit = settings.new_limit.clamp(5, 200);
  settings.retain_days = settings.retain_days.clamp(7, 365);
  sqlx::query("INSERT INTO radar_meta(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(serde_json::to_string(&settings).map_err(err)?)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(settings)
}

fn today() -> String {
  Utc::now().date_naive().to_string()
}

fn clean_arxiv_id(value: &str) -> String {
  let bytes = value.as_bytes();
  let mut i = 0;
  while i + 9 <= bytes.len() {
    if bytes[i].is_ascii_digit()
      && bytes.get(i + 1).is_some_and(|b| b.is_ascii_digit())
      && bytes.get(i + 2).is_some_and(|b| b.is_ascii_digit())
      && bytes.get(i + 3).is_some_and(|b| b.is_ascii_digit())
      && bytes.get(i + 4) == Some(&b'.')
    {
      let mut j = i + 5;
      let mut digits = 0;
      while j < bytes.len() && bytes[j].is_ascii_digit() && digits < 5 {
        j += 1;
        digits += 1;
      }
      if digits >= 4 {
        return value[i..j].to_string();
      }
    }
    i += 1;
  }
  String::new()
}

fn squash(text: &str) -> String {
  text.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn library_arxiv_ids(library: &SqlitePool) -> Result<HashSet<String>> {
  let rows = sqlx::query("SELECT arxiv_id FROM papers WHERE deleted_at IS NULL AND arxiv_id IS NOT NULL AND trim(arxiv_id)<>''")
    .fetch_all(library)
    .await
    .map_err(err)?;
  Ok(rows
    .into_iter()
    .filter_map(|row| {
      let raw: String = row.get("arxiv_id");
      let id = clean_arxiv_id(&raw);
      if id.is_empty() { None } else { Some(id) }
    })
    .collect())
}

async fn upsert_paper_meta(
  pool: &SqlitePool,
  arxiv_id: &str,
  title: &str,
  abstract_text: Option<&str>,
  authors: &[String],
  primary_category: Option<&str>,
  categories: &[String],
  published_date: Option<&str>,
) -> Result<()> {
  let now = Utc::now().to_rfc3339();
  sqlx::query(
    "INSERT INTO radar_papers(arxiv_id,title,abstract_text,authors_json,primary_category,categories_json,published_date,abs_url,alphaxiv_url,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(arxiv_id) DO UPDATE SET
       title=excluded.title,
       abstract_text=COALESCE(excluded.abstract_text, radar_papers.abstract_text),
       authors_json=excluded.authors_json,
       primary_category=COALESCE(excluded.primary_category, radar_papers.primary_category),
       categories_json=excluded.categories_json,
       published_date=COALESCE(excluded.published_date, radar_papers.published_date),
       updated_at=excluded.updated_at",
  )
  .bind(arxiv_id)
  .bind(title)
  .bind(abstract_text)
  .bind(serde_json::to_string(authors).map_err(err)?)
  .bind(primary_category)
  .bind(serde_json::to_string(categories).map_err(err)?)
  .bind(published_date)
  .bind(format!("https://arxiv.org/abs/{arxiv_id}"))
  .bind(format!("https://www.alphaxiv.org/abs/{arxiv_id}"))
  .bind(now)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

async fn upsert_ai_summary(pool: &SqlitePool, arxiv_id: &str, title: Option<&str>, summary: Option<&str>, tags: &[String]) -> Result<()> {
  if summary.is_none() && tags.is_empty() && title.is_none() {
    return Ok(());
  }
  sqlx::query(
    "INSERT INTO radar_ai_summaries(arxiv_id,title,summary_text,tags_json,captured_at)
     VALUES(?,?,?,?,?)
     ON CONFLICT(arxiv_id) DO UPDATE SET
       title=COALESCE(excluded.title, radar_ai_summaries.title),
       summary_text=COALESCE(excluded.summary_text, radar_ai_summaries.summary_text),
       tags_json=CASE WHEN excluded.tags_json!='[]' THEN excluded.tags_json ELSE radar_ai_summaries.tags_json END,
       captured_at=excluded.captured_at",
  )
  .bind(arxiv_id)
  .bind(title)
  .bind(summary)
  .bind(serde_json::to_string(tags).map_err(err)?)
  .bind(today())
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

async fn insert_snapshot(pool: &SqlitePool, date: &str, arxiv_id: &str, feed: &str, rank: i64, upvotes: Option<i64>) -> Result<()> {
  sqlx::query(
    "INSERT INTO radar_snapshots(snapshot_date,arxiv_id,feed,rank,upvotes)
     VALUES(?,?,?,?,?)
     ON CONFLICT(snapshot_date,arxiv_id,feed) DO UPDATE SET rank=excluded.rank, upvotes=COALESCE(excluded.upvotes, radar_snapshots.upvotes)",
  )
  .bind(date)
  .bind(arxiv_id)
  .bind(feed)
  .bind(rank)
  .bind(upvotes)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

async fn fetch_alphaxiv_hot(limit: i64) -> Result<Vec<(String, String, Option<String>, Vec<String>, Option<i64>)>> {
  let client = Client::builder().timeout(Duration::from_secs(45)).build().map_err(err)?;
  let url = format!(
    "https://api.alphaxiv.org/papers/v3/feed?sort=Hot&pageNum=0&pageSize={}&interval={}",
    limit.clamp(5, 50),
    urlencoding_encode("7 Days")
  );
  let response = client
    .get(&url)
    .header("User-Agent", "PaperNest-Radar/0.2.1")
    .header("Accept", "application/json")
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let body: serde_json::Value = response.json().await.map_err(err)?;
  if !status.is_success() {
    return Err(format!("alphaxiv feed 失败（{status}）"));
  }
  let papers = body.get("papers").and_then(|v| v.as_array()).ok_or_else(|| "alphaxiv 响应缺少 papers".to_string())?;
  let mut out = Vec::new();
  for paper in papers {
    let raw_id = paper
      .get("universal_paper_id")
      .and_then(|v| v.as_str())
      .or_else(|| paper.get("canonical_id").and_then(|v| v.as_str()))
      .unwrap_or("");
    let arxiv_id = clean_arxiv_id(raw_id);
    if arxiv_id.is_empty() {
      continue;
    }
    let title = paper.get("title").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if title.is_empty() {
      continue;
    }
    let summary = paper
      .pointer("/paper_summary/summary")
      .and_then(|v| v.as_str())
      .map(str::trim)
      .filter(|v| !v.is_empty())
      .map(str::to_string);
    let tags = paper
      .get("topics")
      .and_then(|v| v.as_array())
      .map(|arr| {
        arr
          .iter()
          .filter_map(|item| item.as_str().map(str::to_string))
          .collect::<Vec<_>>()
      })
      .unwrap_or_default();
    let upvotes = paper
      .pointer("/metrics/public_total_votes")
      .and_then(|v| v.as_i64())
      .or_else(|| paper.pointer("/metrics/total_votes").and_then(|v| v.as_i64()));
    out.push((arxiv_id, title, summary, tags, upvotes));
  }
  Ok(out)
}

fn urlencoding_encode(value: &str) -> String {
  value
    .bytes()
    .map(|b| match b {
      b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
      b' ' => "%20".into(),
      _ => format!("%{b:02X}"),
    })
    .collect()
}

type ArxivEntry = (String, String, String, Vec<String>, Vec<String>, Option<String>, Option<String>);

fn arxiv_user_agent(mailto: Option<&str>) -> String {
  match mailto {
    Some(mail) => format!("PaperNest-Radar/0.2.4 (mailto:{mail})"),
    None => "PaperNest-Radar/0.2.4".into(),
  }
}

fn submitted_date_range(window_days: i64) -> String {
  let end = Utc::now().date_naive();
  let start = end - chrono::Duration::days((window_days - 1).max(0));
  format!(
    "submittedDate:[{}0000 TO {}2359]",
    start.format("%Y%m%d"),
    end.format("%Y%m%d")
  )
}

fn category_or_query(categories: &[String]) -> String {
  categories.iter().map(|c| format!("cat:{c}")).collect::<Vec<_>>().join(" OR ")
}

fn escape_arxiv_phrase(value: &str) -> String {
  value.replace('\\', "\\\\").replace('"', "\\\"")
}

fn build_interest_query(keyword: &str, categories: &[String], window_days: i64) -> String {
  let phrase = escape_arxiv_phrase(keyword.trim());
  let kw = format!("(ti:\"{phrase}\" OR abs:\"{phrase}\")");
  let mut parts = vec![kw];
  if !categories.is_empty() {
    parts.push(format!("({})", category_or_query(categories)));
  }
  parts.push(submitted_date_range(window_days));
  parts.join(" AND ")
}

async fn arxiv_query(search_query: &str, limit: i64, mailto: Option<&str>) -> Result<Vec<ArxivEntry>> {
  let client = Client::builder().timeout(Duration::from_secs(45)).build().map_err(err)?;
  let url = format!(
    "https://export.arxiv.org/api/query?search_query={}&sortBy=submittedDate&sortOrder=descending&max_results={}",
    urlencoding_encode(search_query),
    limit.clamp(5, 200)
  );
  let response = client
    .get(&url)
    .header("User-Agent", arxiv_user_agent(mailto))
    .send()
    .await
    .map_err(err)?;
  let status = response.status();
  let text = response.text().await.map_err(err)?;
  if !status.is_success() {
    return Err(format!("arXiv API 失败（{status}）"));
  }
  Ok(parse_arxiv_atom(&text))
}

async fn fetch_arxiv_new(categories: &[String], limit: i64, mailto: Option<&str>) -> Result<Vec<ArxivEntry>> {
  if categories.is_empty() {
    return Ok(vec![]);
  }
  let query = format!(
    "({}) AND {}",
    category_or_query(categories),
    submitted_date_range(NEW_WINDOW_DAYS)
  );
  arxiv_query(&query, limit, mailto).await
}

async fn fetch_arxiv_interest(
  keywords: &[String],
  categories: &[String],
  mailto: Option<&str>,
) -> Result<Vec<ArxivEntry>> {
  let kws = normalized_keywords(keywords);
  if kws.is_empty() {
    return Ok(vec![]);
  }
  let mut seen = HashSet::new();
  let mut out = Vec::new();
  for (index, keyword) in kws.iter().enumerate() {
    if index > 0 {
      tokio::time::sleep(Duration::from_millis(3100)).await;
    }
    let query = build_interest_query(keyword, categories, INTEREST_WINDOW_DAYS);
    let batch = arxiv_query(&query, INTEREST_PER_KEYWORD, mailto).await?;
    for entry in batch {
      if seen.insert(entry.0.clone()) {
        out.push(entry);
        if out.len() >= INTEREST_TOTAL_CAP {
          return Ok(out);
        }
      }
    }
  }
  Ok(out)
}

fn parse_arxiv_atom(xml: &str) -> Vec<ArxivEntry> {
  let mut out = Vec::new();
  for entry in xml.split("<entry>").skip(1) {
    let block = entry.split("</entry>").next().unwrap_or("");
    let id_raw = xml_tag(block, "id").unwrap_or_default();
    let arxiv_id = clean_arxiv_id(&id_raw);
    if arxiv_id.is_empty() {
      continue;
    }
    let title = squash(&xml_tag(block, "title").unwrap_or_default());
    let summary = squash(&xml_tag(block, "summary").unwrap_or_default());
    let published = xml_tag(block, "published");
    let mut authors = Vec::new();
    for author in block.split("<author>").skip(1) {
      if let Some(name) = xml_tag(author, "name") {
        authors.push(name);
      }
    }
    let mut categories = Vec::new();
    for part in block.split("<category").skip(1) {
      if let Some(term) = part.split("term=\"").nth(1).and_then(|s| s.split('"').next()) {
        categories.push(term.to_string());
      }
    }
    let primary = categories.first().cloned();
    out.push((arxiv_id, title, summary, authors, categories, primary, published));
  }
  out
}

fn xml_tag(block: &str, tag: &str) -> Option<String> {
  let open = format!("<{tag}");
  let start = block.find(&open)?;
  let after = &block[start..];
  let content_start = after.find('>')? + 1;
  let close = format!("</{tag}>");
  let end = after.find(&close)?;
  Some(after[content_start..end].replace("<![CDATA[", "").replace("]]>", "").trim().to_string())
}

async fn prune_old(pool: &SqlitePool, retain_days: i64) -> Result<()> {
  let cutoff = (Utc::now().date_naive() - chrono::Duration::days(retain_days)).to_string();
  sqlx::query("DELETE FROM radar_snapshots WHERE snapshot_date<?")
    .bind(&cutoff)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

fn normalized_keywords(keywords: &[String]) -> Vec<String> {
  keywords
    .iter()
    .map(|value| value.trim().to_ascii_lowercase())
    .filter(|value| !value.is_empty())
    .collect()
}

fn category_labels(primary: Option<&str>, categories: &[String], topics: &[String]) -> Vec<String> {
  let mut labels = Vec::new();
  if let Some(value) = primary.filter(|v| !v.trim().is_empty()) {
    labels.push(value.to_string());
  }
  labels.extend(categories.iter().cloned());
  labels.extend(topics.iter().cloned());
  labels
}

fn category_matches(subscribed: &[String], primary: Option<&str>, categories: &[String], topics: &[String]) -> bool {
  if subscribed.is_empty() {
    return true;
  }
  let labels = category_labels(primary, categories, topics);
  if labels.is_empty() {
    return true;
  }
  subscribed.iter().any(|sub| {
    labels.iter().any(|label| {
      label.eq_ignore_ascii_case(sub)
        || label.starts_with(&format!("{sub}."))
        || sub.starts_with(label.as_str())
    })
  })
}

fn keyword_matches(keywords: &[String], title: &str, abstract_text: Option<&str>, ai_summary: Option<&str>) -> bool {
  let normalized = normalized_keywords(keywords);
  if normalized.is_empty() {
    return true;
  }
  let blob = format!(
    "{} {} {}",
    title,
    abstract_text.unwrap_or(""),
    ai_summary.unwrap_or("")
  )
  .to_ascii_lowercase();
  normalized.iter().any(|keyword| blob.contains(keyword))
}

fn interest_match(
  keywords: &[String],
  subscribed: &[String],
  title: &str,
  abstract_text: Option<&str>,
  ai_summary: Option<&str>,
  primary: Option<&str>,
  categories: &[String],
  topics: &[String],
) -> bool {
  let kw = normalized_keywords(keywords);
  let keyword_ok = keyword_matches(keywords, title, abstract_text, ai_summary);
  let category_ok = category_matches(subscribed, primary, categories, topics);
  match (kw.is_empty(), subscribed.is_empty()) {
    (true, true) => true,
    (true, false) => category_ok,
    (false, true) => keyword_ok,
    (false, false) => keyword_ok && category_ok,
  }
}

fn card_matches_interest(card: &RadarCard, settings: &RadarSettings) -> bool {
  interest_match(
    &settings.keywords,
    &settings.categories,
    &card.title,
    card.abstract_text.as_deref(),
    card.ai_summary.as_deref(),
    card.primary_category.as_deref(),
    &card.categories,
    &card.topics,
  )
}

fn apply_interest_filter(cards: Vec<RadarCard>, settings: &RadarSettings) -> Vec<RadarCard> {
  cards
    .into_iter()
    .filter(|card| card_matches_interest(card, settings))
    .collect()
}

async fn list_cards(pool: &SqlitePool, library: &SqlitePool, date: &str, feed: &str, include_hidden: bool) -> Result<Vec<RadarCard>> {
  let in_library = library_arxiv_ids(library).await?;
  let rows = sqlx::query(
    "SELECT s.snapshot_date,s.arxiv_id,s.feed,s.rank,s.upvotes,
            COALESCE(p.title,a.title,'') AS title,
            p.abstract_text,a.summary_text,
            COALESCE(p.authors_json,'[]') AS authors_json, COALESCE(p.categories_json,'[]') AS categories_json,
            COALESCE(a.tags_json,'[]') AS tags_json,
            p.primary_category,p.published_date,p.abs_url,p.alphaxiv_url,
            COALESCE(u.later,0) AS later, COALESCE(u.hidden,0) AS hidden
     FROM radar_snapshots s
     LEFT JOIN radar_papers p ON p.arxiv_id=s.arxiv_id
     LEFT JOIN radar_ai_summaries a ON a.arxiv_id=s.arxiv_id
     LEFT JOIN radar_user_state u ON u.arxiv_id=s.arxiv_id
     WHERE s.snapshot_date=? AND s.feed=?
       AND ((? AND COALESCE(u.hidden,0)=1) OR (NOT ? AND COALESCE(u.hidden,0)=0))
     ORDER BY CASE WHEN s.rank IS NULL THEN 9999 ELSE s.rank END ASC, COALESCE(s.upvotes,0) DESC",
  )
  .bind(date)
  .bind(feed)
  .bind(include_hidden)
  .bind(include_hidden)
  .fetch_all(pool)
  .await
  .map_err(err)?;
  let mut cards = Vec::new();
  for row in rows {
    let arxiv_id: String = row.get("arxiv_id");
    cards.push(RadarCard {
      arxiv_id: arxiv_id.clone(),
      title: row.get("title"),
      abstract_text: row.get("abstract_text"),
      ai_summary: row.get("summary_text"),
      authors: serde_json::from_str(&row.get::<String, _>("authors_json")).unwrap_or_default(),
      categories: serde_json::from_str(&row.get::<String, _>("categories_json")).unwrap_or_default(),
      topics: serde_json::from_str(&row.get::<String, _>("tags_json")).unwrap_or_default(),
      primary_category: row.get("primary_category"),
      published_date: row.get("published_date"),
      abs_url: row.get("abs_url"),
      alphaxiv_url: row.get("alphaxiv_url"),
      feed: row.get("feed"),
      rank: row.get("rank"),
      upvotes: row.get("upvotes"),
      snapshot_date: row.get("snapshot_date"),
      in_library: in_library.contains(&arxiv_id),
      later: row.get::<i64, _>("later") != 0,
      hidden: row.get::<i64, _>("hidden") != 0,
    });
  }
  Ok(cards)
}

#[tauri::command]
pub async fn radar_get_settings(state: State<'_, AppState>) -> Result<RadarSettings> {
  let pool = open_radar_pool(&state.library_dir).await?;
  let settings = load_settings(&pool).await?;
  pool.close().await;
  Ok(settings)
}

#[tauri::command]
pub async fn radar_save_settings(state: State<'_, AppState>, settings: RadarSettings) -> Result<RadarSettings> {
  let pool = open_radar_pool(&state.library_dir).await?;
  let saved = save_settings(&pool, settings).await?;
  pool.close().await;
  Ok(saved)
}

#[tauri::command]
pub async fn radar_category_catalog() -> Result<Vec<[String; 2]>> {
  Ok(category_catalog().into_iter().map(|(a, b)| [a, b]).collect())
}

#[tauri::command]
pub async fn radar_list_dates(state: State<'_, AppState>) -> Result<Vec<String>> {
  let pool = open_radar_pool(&state.library_dir).await?;
  let rows = sqlx::query("SELECT DISTINCT snapshot_date FROM radar_snapshots ORDER BY snapshot_date DESC LIMIT 120")
    .fetch_all(&pool)
    .await
    .map_err(err)?;
  pool.close().await;
  Ok(rows.into_iter().map(|row| row.get("snapshot_date")).collect())
}

#[tauri::command]
pub async fn radar_list_feed(
  state: State<'_, AppState>,
  date: String,
  feed: String,
  interest_filter: Option<bool>,
  include_hidden: Option<bool>,
) -> Result<RadarFeedPage> {
  let pool = open_radar_pool(&state.library_dir).await?;
  let settings = load_settings(&pool).await?;
  let library = state.pool.read().await;
  let show_hidden = include_hidden.unwrap_or(false);
  let all = list_cards(&pool, &library, &date, &feed, show_hidden).await?;
  drop(library);
  pool.close().await;
  let total_count = all.len();
  let apply = interest_filter.unwrap_or(settings.default_filter_enabled);
  let cards = if apply && feed != "interest" {
    apply_interest_filter(all, &settings)
  } else {
    all
  };
  Ok(RadarFeedPage {
    cards,
    total_count,
    interest_filter_applied: apply && feed != "interest",
  })
}

#[tauri::command]
pub async fn radar_fetch_today(state: State<'_, AppState>) -> Result<RadarFetchResult> {
  let radar = open_radar_pool(&state.library_dir).await?;
  let settings = load_settings(&radar).await?;
  if !settings.enabled {
    radar.close().await;
    return Err("请先在设置中启用论文雷达".into());
  }
  let started = Utc::now().to_rfc3339();
  let date = today();
  let mut errors = Vec::new();
  let mut feeds_ok = Vec::new();
  let mut hot_count = 0i64;
  let mut new_count = 0i64;
  let mut interest_count = 0i64;
  let mut papers_added = 0i64;
  let mut arxiv_calls = 0u32;

  match fetch_alphaxiv_hot(settings.hot_limit).await {
    Ok(cards) => {
      for (index, (arxiv_id, title, summary, tags, upvotes)) in cards.into_iter().enumerate() {
        upsert_paper_meta(&radar, &arxiv_id, &title, None, &[], None, &[], None).await?;
        upsert_ai_summary(&radar, &arxiv_id, Some(&title), summary.as_deref(), &tags).await?;
        insert_snapshot(&radar, &date, &arxiv_id, "hot", (index + 1) as i64, upvotes).await?;
        hot_count += 1;
        papers_added += 1;
      }
      feeds_ok.push("hot");
    }
    Err(error) => errors.push(format!("hot: {error}")),
  }

  if arxiv_calls > 0 {
    tokio::time::sleep(Duration::from_millis(3100)).await;
  }
  arxiv_calls += 1;
  match fetch_arxiv_new(&settings.categories, settings.new_limit, settings.mailto.as_deref()).await {
    Ok(cards) => {
      for (index, (arxiv_id, title, summary, authors, categories, primary, published)) in cards.into_iter().enumerate() {
        upsert_paper_meta(
          &radar,
          &arxiv_id,
          &title,
          Some(&summary),
          &authors,
          primary.as_deref(),
          &categories,
          published.as_deref(),
        )
        .await?;
        insert_snapshot(&radar, &date, &arxiv_id, "new", (index + 1) as i64, None).await?;
        new_count += 1;
        papers_added += 1;
      }
      feeds_ok.push("new");
    }
    Err(error) => errors.push(format!("new: {error}")),
  }

  if !normalized_keywords(&settings.keywords).is_empty() {
    if arxiv_calls > 0 {
      tokio::time::sleep(Duration::from_millis(3100)).await;
    }
    arxiv_calls += 1;
    match fetch_arxiv_interest(&settings.keywords, &settings.categories, settings.mailto.as_deref()).await {
      Ok(cards) => {
        for (index, (arxiv_id, title, summary, authors, categories, primary, published)) in cards.into_iter().enumerate() {
          upsert_paper_meta(
            &radar,
            &arxiv_id,
            &title,
            Some(&summary),
            &authors,
            primary.as_deref(),
            &categories,
            published.as_deref(),
          )
          .await?;
          insert_snapshot(&radar, &date, &arxiv_id, "interest", (index + 1) as i64, None).await?;
          interest_count += 1;
          papers_added += 1;
        }
        feeds_ok.push("interest");
      }
      Err(error) => errors.push(format!("interest: {error}")),
    }
  }

  // Enrich hot cards missing abstracts via arXiv id_list (batched).
  let missing: Vec<String> = sqlx::query(
    "SELECT p.arxiv_id FROM radar_papers p
     JOIN radar_snapshots s ON s.arxiv_id=p.arxiv_id AND s.snapshot_date=? AND s.feed='hot'
     WHERE p.abstract_text IS NULL OR trim(p.abstract_text)=''",
  )
  .bind(&date)
  .fetch_all(&radar)
  .await
  .map_err(err)?
  .into_iter()
  .map(|row| row.get::<String, _>("arxiv_id"))
  .collect();
  if !missing.is_empty() {
    if arxiv_calls > 0 {
      tokio::time::sleep(Duration::from_millis(3100)).await;
    }
    if let Err(error) = enrich_arxiv_ids(&radar, &missing, settings.mailto.as_deref()).await {
      errors.push(format!("enrich: {error}"));
    }
  }

  prune_old(&radar, settings.retain_days).await?;
  let status = if errors.is_empty() {
    "ok"
  } else if feeds_ok.is_empty() {
    "failed"
  } else {
    "partial"
  };
  sqlx::query("INSERT INTO radar_run_log(started_at,finished_at,status,feeds_json,papers_added,errors_json) VALUES(?,?,?,?,?,?)")
    .bind(&started)
    .bind(Utc::now().to_rfc3339())
    .bind(status)
    .bind(serde_json::to_string(&feeds_ok).map_err(err)?)
    .bind(papers_added)
    .bind(serde_json::to_string(&errors).map_err(err)?)
    .execute(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  if feeds_ok.is_empty() {
    return Err(errors.join("; "));
  }
  Ok(RadarFetchResult {
    snapshot_date: date,
    hot_count,
    new_count,
    interest_count,
    errors,
    status: status.into(),
  })
}

async fn enrich_arxiv_ids(pool: &SqlitePool, ids: &[String], mailto: Option<&str>) -> Result<()> {
  let client = Client::builder().timeout(Duration::from_secs(45)).build().map_err(err)?;
  for chunk in ids.chunks(15) {
    let id_list = chunk.join(",");
    let url = format!(
      "https://export.arxiv.org/api/query?id_list={}&max_results={}",
      urlencoding_encode(&id_list),
      chunk.len()
    );
    let response = client
      .get(&url)
      .header("User-Agent", arxiv_user_agent(mailto))
      .send()
      .await
      .map_err(err)?;
    let text = response.text().await.map_err(err)?;
    for (arxiv_id, title, summary, authors, categories, primary, published) in parse_arxiv_atom(&text) {
      upsert_paper_meta(
        pool,
        &arxiv_id,
        &title,
        Some(&summary),
        &authors,
        primary.as_deref(),
        &categories,
        published.as_deref(),
      )
      .await?;
    }
    tokio::time::sleep(Duration::from_millis(3100)).await;
  }
  Ok(())
}

#[tauri::command]
pub async fn radar_week_hot(state: State<'_, AppState>, anchor_date: Option<String>) -> Result<RadarWeekHot> {
  let radar = open_radar_pool(&state.library_dir).await?;
  let end = anchor_date.unwrap_or_else(today);
  let end_date = chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d").map_err(err)?;
  let start = (end_date - chrono::Duration::days(6)).to_string();
  let coverage: i64 = sqlx::query_scalar(
    "SELECT COUNT(DISTINCT snapshot_date) FROM radar_snapshots WHERE snapshot_date>=? AND snapshot_date<=?",
  )
  .bind(&start)
  .bind(&end)
  .fetch_one(&radar)
  .await
  .map_err(err)?;
  let cat_rows = sqlx::query(
    "SELECT COALESCE(p.primary_category,'(未分类)') AS category, COUNT(DISTINCT s.arxiv_id) AS paper_count, COALESCE(MAX(s.upvotes),0) AS max_upvotes
     FROM radar_snapshots s
     LEFT JOIN radar_papers p ON p.arxiv_id=s.arxiv_id
     WHERE s.snapshot_date>=? AND s.snapshot_date<=? AND s.feed='hot'
     GROUP BY COALESCE(p.primary_category,'(未分类)')
     ORDER BY paper_count DESC, max_upvotes DESC
     LIMIT 12",
  )
  .bind(&start)
  .bind(&end)
  .fetch_all(&radar)
  .await
  .map_err(err)?;
  let categories = cat_rows
    .into_iter()
    .map(|row| RadarWeekCategory {
      category: row.get("category"),
      paper_count: row.get("paper_count"),
      max_upvotes: row.get("max_upvotes"),
    })
    .collect();
  let persist_rows = sqlx::query(
    "SELECT s.arxiv_id, COALESCE(p.title,a.title,s.arxiv_id) AS title, COUNT(DISTINCT s.snapshot_date) AS days, COALESCE(MAX(s.upvotes),0) AS peak_upvotes
     FROM radar_snapshots s
     LEFT JOIN radar_papers p ON p.arxiv_id=s.arxiv_id
     LEFT JOIN radar_ai_summaries a ON a.arxiv_id=s.arxiv_id
     WHERE s.snapshot_date>=? AND s.snapshot_date<=? AND s.feed='hot'
     GROUP BY s.arxiv_id
     HAVING days>=2
     ORDER BY days DESC, peak_upvotes DESC
     LIMIT 15",
  )
  .bind(&start)
  .bind(&end)
  .fetch_all(&radar)
  .await
  .map_err(err)?;
  let persistent = persist_rows
    .into_iter()
    .map(|row| RadarPersistentPaper {
      arxiv_id: row.get("arxiv_id"),
      title: row.get("title"),
      days: row.get("days"),
      peak_upvotes: row.get("peak_upvotes"),
    })
    .collect();
  radar.close().await;
  Ok(RadarWeekHot {
    window_start: start,
    window_end: end,
    coverage_days: coverage,
    categories,
    persistent,
  })
}

#[tauri::command]
pub async fn radar_set_user_state(state: State<'_, AppState>, arxiv_id: String, later: Option<bool>, hidden: Option<bool>) -> Result<()> {
  let id = clean_arxiv_id(&arxiv_id);
  if id.is_empty() {
    return Err("无效 arXiv ID".into());
  }
  let radar = open_radar_pool(&state.library_dir).await?;
  let now = Utc::now().to_rfc3339();
  sqlx::query("INSERT INTO radar_user_state(arxiv_id,later,hidden,updated_at) VALUES(?,?,?,?) ON CONFLICT(arxiv_id) DO UPDATE SET later=COALESCE(?,radar_user_state.later), hidden=COALESCE(?,radar_user_state.hidden), updated_at=excluded.updated_at")
    .bind(&id)
    .bind(i64::from(later.unwrap_or(false)))
    .bind(i64::from(hidden.unwrap_or(false)))
    .bind(&now)
    .bind(later.map(i64::from))
    .bind(hidden.map(i64::from))
    .execute(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  Ok(())
}

#[tauri::command]
pub async fn radar_recommend(
  state: State<'_, AppState>,
  anchor_date: Option<String>,
  interest_filter: Option<bool>,
) -> Result<RadarRecommendResult> {
  let radar = open_radar_pool(&state.library_dir).await?;
  let settings = load_settings(&radar).await?;
  let apply_interest = interest_filter.unwrap_or(settings.default_filter_enabled);
  let library = state.pool.read().await;
  let in_library = library_arxiv_ids(&library).await?;
  let profile = load_profile_field(&library).await;
  drop(library);

  let end = anchor_date.unwrap_or_else(today);
  let end_date = chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d").map_err(err)?;
  let mut window_days = 30i64;
  let mut strategy = "personalized_rules".to_string();
  let mut items = Vec::new();
  let mut coverage_days = 0i64;

  for days in [30i64, 60, 90] {
    window_days = days;
    let start = (end_date - chrono::Duration::days(days - 1)).to_string();
    coverage_days = sqlx::query_scalar(
      "SELECT COUNT(DISTINCT snapshot_date) FROM radar_snapshots WHERE snapshot_date>=? AND snapshot_date<=?",
    )
    .bind(&start)
    .bind(&end)
    .fetch_one(&radar)
    .await
    .map_err(err)?;
    if coverage_days == 0 {
      continue;
    }
    let candidates = candidate_rows(&radar, &start, &end).await?;
    let interest_candidates: Vec<CandidateRow> = if apply_interest {
      candidates
        .iter()
        .filter(|row| candidate_matches_interest(row, &settings))
        .cloned()
        .collect()
    } else {
      candidates.clone()
    };
    let scored = score_candidates(
      if interest_candidates.is_empty() && apply_interest {
        &candidates
      } else {
        &interest_candidates
      },
      &settings.categories,
      &settings.keywords,
      profile.as_deref(),
      &in_library,
      !(interest_candidates.is_empty() && apply_interest),
    );
    if !scored.is_empty() {
      strategy = if apply_interest && !interest_candidates.is_empty() && interest_candidates.len() < candidates.len() {
        "interest_filtered".into()
      } else if apply_interest && interest_candidates.is_empty() {
        "interest_expanded".into()
      } else if days == 30 {
        "personalized_rules".into()
      } else {
        "expanded_window".into()
      };
      items = scored;
      break;
    }
    let scored_all = score_candidates(
      &candidates,
      &settings.categories,
      &settings.keywords,
      profile.as_deref(),
      &in_library,
      false,
    );
    if !scored_all.is_empty() {
      strategy = "relaxed_filters".into();
      items = scored_all;
      break;
    }
  }

  if items.is_empty() {
    let hot = list_cards(&radar, &*state.pool.read().await, &end, "hot", false).await?;
    if !hot.is_empty() {
      strategy = "board_hot".into();
      items = hot
        .into_iter()
        .take(20)
        .map(|card| RadarRecommendItem {
          reasons: vec!["今日热点榜".into()],
          score: card.upvotes.unwrap_or(0) as f64,
          card,
        })
        .collect();
    }
  }
  if items.is_empty() {
    let new_cards = list_cards(&radar, &*state.pool.read().await, &end, "new", false).await?;
    if !new_cards.is_empty() {
      strategy = "board_new".into();
      items = new_cards
        .into_iter()
        .take(20)
        .map(|card| RadarRecommendItem {
          reasons: vec!["今日新稿榜".into()],
          score: 0.0,
          card,
        })
        .collect();
    }
  }
  if items.is_empty() {
    let interest_cards = list_cards(&radar, &*state.pool.read().await, &end, "interest", false).await?;
    if !interest_cards.is_empty() {
      strategy = "board_interest".into();
      items = interest_cards
        .into_iter()
        .take(20)
        .map(|card| RadarRecommendItem {
          reasons: vec!["今日兴趣召回".into()],
          score: 0.0,
          card,
        })
        .collect();
    }
  }
  if items.is_empty() {
    strategy = "empty_cta".into();
  }

  let query_parts: Vec<String> = settings
    .keywords
    .iter()
    .cloned()
    .chain(profile.clone().into_iter())
    .collect();
  if !items.is_empty() && !query_parts.is_empty() {
    if let Ok(llm) = load_llm_settings(&*state.pool.read().await).await {
      let model = llm.embedding_model.as_deref().map(str::trim).filter(|v| !v.is_empty());
      let can_embed = match model {
        Some(m) if crate::local_embed::is_local_embed_model(m) => true,
        Some(_) => llm.api_key_saved,
        None => false,
      };
      if can_embed {
        match apply_embedding_rerank(&radar, &llm, &query_parts.join(" "), &mut items).await {
          Ok(true) => {
            if strategy != "empty_cta" && !strategy.starts_with("board_") {
              strategy = "embedding_rerank".into();
            }
          }
          Ok(false) => {}
          Err(_) => {}
        }
      }
    }
  }

  radar.close().await;
  Ok(RadarRecommendResult {
    strategy,
    window_days,
    coverage_days,
    items: items.into_iter().take(30).collect(),
  })
}

async fn load_profile_field(library: &SqlitePool) -> Option<String> {
  let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key='profile'")
    .fetch_optional(library)
    .await
    .ok()
    .flatten();
  raw.and_then(|value| serde_json::from_str::<Profile>(&value).ok()).map(|p| p.research_field).filter(|v| !v.trim().is_empty())
}

fn embedding_text_hash(text: &str) -> String {
  let mut h: u64 = 0xcbf29ce484222325;
  for b in text.as_bytes() {
    h ^= *b as u64;
    h = h.wrapping_mul(0x100000001b3);
  }
  format!("{h:016x}:{}", text.len())
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
  let n = a.len().min(b.len());
  if n == 0 {
    return 0.0;
  }
  let mut dot = 0.0;
  let mut na = 0.0;
  let mut nb = 0.0;
  for i in 0..n {
    let x = a[i] as f64;
    let y = b[i] as f64;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if na == 0.0 || nb == 0.0 {
    return 0.0;
  }
  dot / (na.sqrt() * nb.sqrt())
}

fn card_embed_text(card: &RadarCard) -> String {
  format!(
    "{} {} {}",
    card.title,
    card.abstract_text.clone().unwrap_or_default(),
    card.ai_summary.clone().unwrap_or_default()
  )
  .chars()
  .take(4000)
  .collect()
}

async fn load_cached_embedding(pool: &SqlitePool, arxiv_id: &str, text_hash: &str, model: &str) -> Result<Option<Vec<f32>>> {
  let row = sqlx::query("SELECT vector_json FROM radar_embeddings WHERE arxiv_id=? AND text_hash=? AND model=?")
    .bind(arxiv_id)
    .bind(text_hash)
    .bind(model)
    .fetch_optional(pool)
    .await
    .map_err(err)?;
  Ok(row.and_then(|r| {
    let raw: String = r.get("vector_json");
    serde_json::from_str(&raw).ok()
  }))
}

async fn save_cached_embedding(pool: &SqlitePool, arxiv_id: &str, text_hash: &str, model: &str, vector: &[f32]) -> Result<()> {
  sqlx::query(
    "INSERT INTO radar_embeddings(arxiv_id,text_hash,model,vector_json,updated_at) VALUES(?,?,?,?,?)
     ON CONFLICT(arxiv_id) DO UPDATE SET text_hash=excluded.text_hash, model=excluded.model, vector_json=excluded.vector_json, updated_at=excluded.updated_at",
  )
  .bind(arxiv_id)
  .bind(text_hash)
  .bind(model)
  .bind(serde_json::to_string(vector).map_err(err)?)
  .bind(Utc::now().to_rfc3339())
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

/// Returns Ok(true) when at least one item received an embedding boost.
async fn apply_embedding_rerank(
  pool: &SqlitePool,
  llm: &LlmSettings,
  query: &str,
  items: &mut Vec<RadarRecommendItem>,
) -> Result<bool> {
  let model = llm
    .embedding_model
    .as_deref()
    .map(str::trim)
    .filter(|v| !v.is_empty())
    .ok_or_else(|| "未配置 embedding 模型".to_string())?;
  let query = query.trim();
  if query.is_empty() || items.is_empty() {
    return Ok(false);
  }

  let mut query_vecs = llm_embeddings(llm, vec![query.chars().take(2000).collect()]).await?;
  let query_vec = query_vecs.pop().ok_or_else(|| "query embedding 为空".to_string())?;

  let top_n = items.len().min(40);
  let mut pending_ids = Vec::new();
  let mut pending_texts = Vec::new();
  let mut pending_hashes = Vec::new();
  let mut vectors: Vec<Option<Vec<f32>>> = vec![None; top_n];

  for (index, item) in items.iter().take(top_n).enumerate() {
    let text = card_embed_text(&item.card);
    let hash = embedding_text_hash(&text);
    if let Some(cached) = load_cached_embedding(pool, &item.card.arxiv_id, &hash, model).await? {
      vectors[index] = Some(cached);
    } else {
      pending_ids.push(index);
      pending_texts.push(text);
      pending_hashes.push(hash);
    }
  }

  for chunk_start in (0..pending_texts.len()).step_by(16) {
    let end = (chunk_start + 16).min(pending_texts.len());
    let batch = pending_texts[chunk_start..end].to_vec();
    let embeds = llm_embeddings(llm, batch).await?;
    if embeds.len() != end - chunk_start {
      return Err("Embeddings 返回条数与请求不一致".into());
    }
    for (offset, vector) in embeds.into_iter().enumerate() {
      let i = pending_ids[chunk_start + offset];
      let arxiv_id = items[i].card.arxiv_id.clone();
      let hash = &pending_hashes[chunk_start + offset];
      let _ = save_cached_embedding(pool, &arxiv_id, hash, model, &vector).await;
      vectors[i] = Some(vector);
    }
  }

  let mut boosted = false;
  for (index, item) in items.iter_mut().take(top_n).enumerate() {
    if let Some(vector) = vectors[index].as_ref() {
      let sim = cosine_similarity(&query_vec, vector).clamp(0.0, 1.0);
      item.score += 0.3 * sim;
      if sim >= 0.35 {
        item.reasons.push(format!("语义相近 {:.0}%", sim * 100.0));
        boosted = true;
      } else if sim > 0.0 {
        boosted = true;
      }
    }
  }
  items.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
  Ok(boosted)
}

#[derive(Clone)]
struct CandidateRow {
  arxiv_id: String,
  title: String,
  abstract_text: Option<String>,
  ai_summary: Option<String>,
  categories: Vec<String>,
  topics: Vec<String>,
  primary_category: Option<String>,
  upvotes: i64,
  rank: i64,
  latest: String,
  later: bool,
  hidden: bool,
}

fn candidate_matches_interest(row: &CandidateRow, settings: &RadarSettings) -> bool {
  interest_match(
    &settings.keywords,
    &settings.categories,
    &row.title,
    row.abstract_text.as_deref(),
    row.ai_summary.as_deref(),
    row.primary_category.as_deref(),
    &row.categories,
    &row.topics,
  )
}

async fn candidate_rows(pool: &SqlitePool, start: &str, end: &str) -> Result<Vec<CandidateRow>> {
  let rows = sqlx::query(
    "SELECT s.arxiv_id,
            COALESCE(p.title,a.title,s.arxiv_id) AS title,
            p.abstract_text,a.summary_text,p.categories_json,COALESCE(a.tags_json,'[]') AS tags_json,p.primary_category,
            COALESCE(MAX(s.upvotes),0) AS upvotes,
            MIN(CASE WHEN s.rank IS NULL THEN 9999 ELSE s.rank END) AS rank,
            MAX(s.snapshot_date) AS latest,
            COALESCE(MAX(u.later),0) AS later,
            COALESCE(MAX(u.hidden),0) AS hidden
     FROM radar_snapshots s
     LEFT JOIN radar_papers p ON p.arxiv_id=s.arxiv_id
     LEFT JOIN radar_ai_summaries a ON a.arxiv_id=s.arxiv_id
     LEFT JOIN radar_user_state u ON u.arxiv_id=s.arxiv_id
     WHERE s.snapshot_date>=? AND s.snapshot_date<=?
     GROUP BY s.arxiv_id",
  )
  .bind(start)
  .bind(end)
  .fetch_all(pool)
  .await
  .map_err(err)?;
  Ok(rows
    .into_iter()
    .map(|row| CandidateRow {
      arxiv_id: row.get("arxiv_id"),
      title: row.get("title"),
      abstract_text: row.get("abstract_text"),
      ai_summary: row.get("summary_text"),
      categories: serde_json::from_str(&row.get::<Option<String>, _>("categories_json").unwrap_or_else(|| "[]".into())).unwrap_or_default(),
      topics: serde_json::from_str(&row.get::<String, _>("tags_json")).unwrap_or_default(),
      primary_category: row.get("primary_category"),
      upvotes: row.get("upvotes"),
      rank: row.get("rank"),
      latest: row.get("latest"),
      later: row.get::<i64, _>("later") != 0,
      hidden: row.get::<i64, _>("hidden") != 0,
    })
    .collect())
}

fn score_candidates(
  candidates: &[CandidateRow],
  subscribed: &[String],
  keywords: &[String],
  research_field: Option<&str>,
  in_library: &HashSet<String>,
  exclude_library_and_hidden: bool,
) -> Vec<RadarRecommendItem> {
  let max_up = candidates.iter().map(|c| c.upvotes).max().unwrap_or(0).max(1) as f64;
  let mut field_tokens: HashSet<String> = normalized_keywords(keywords).into_iter().collect();
  if let Some(value) = research_field {
    for token in value
      .split(|c: char| !c.is_alphanumeric())
      .filter(|t| t.len() >= 2)
      .map(|t| t.to_ascii_lowercase())
    {
      field_tokens.insert(token);
    }
  }
  let mut scored = Vec::new();
  for row in candidates {
    if exclude_library_and_hidden && (row.hidden || in_library.contains(&row.arxiv_id)) {
      continue;
    }
    let mut cats = row.categories.clone();
    if cats.is_empty() {
      if let Some(primary) = &row.primary_category {
        cats.push(primary.clone());
      }
    }
    let matched: Vec<_> = cats.iter().filter(|c| subscribed.iter().any(|s| s == *c)).cloned().collect();
    let sub_score = if matched.is_empty() { 0.0 } else { 1.0 };
    let heat = row.upvotes as f64 / max_up;
    let rank_score = if row.rank >= 9999 { 0.0 } else { 1.0 - ((row.rank - 1) as f64 / 40.0).min(1.0) };
    let blob = format!(
      "{} {} {}",
      row.title,
      row.abstract_text.clone().unwrap_or_default(),
      row.ai_summary.clone().unwrap_or_default()
    )
    .to_ascii_lowercase();
    let overlap = if field_tokens.is_empty() {
      0.0
    } else {
      let hits = field_tokens.iter().filter(|token| blob.contains(token.as_str())).count();
      hits as f64 / field_tokens.len() as f64
    };
    let later_boost = if row.later { 0.15 } else { 0.0 };
    let score = 0.35 * sub_score + 0.25 * heat + 0.15 * rank_score + 0.20 * overlap + later_boost;
    let mut reasons = Vec::new();
    if !matched.is_empty() {
      reasons.push(format!("订阅 {}", matched.join("/")));
    }
    if overlap > 0.0 {
      reasons.push("与兴趣关键词相近".into());
    }
    if row.upvotes > 0 {
      reasons.push(format!("热度 {}", row.upvotes));
    }
    if row.later {
      reasons.push("稍后阅读".into());
    }
    if reasons.is_empty() {
      reasons.push("新鲜度".into());
    }
    scored.push((
      score,
      RadarRecommendItem {
        score,
        reasons,
        card: RadarCard {
          arxiv_id: row.arxiv_id.clone(),
          title: row.title.clone(),
          abstract_text: row.abstract_text.clone(),
          ai_summary: row.ai_summary.clone(),
          authors: vec![],
          categories: cats,
          topics: row.topics.clone(),
          primary_category: row.primary_category.clone(),
          published_date: None,
          abs_url: Some(format!("https://arxiv.org/abs/{}", row.arxiv_id)),
          alphaxiv_url: Some(format!("https://www.alphaxiv.org/abs/{}", row.arxiv_id)),
          feed: "recommend".into(),
          rank: Some(row.rank),
          upvotes: Some(row.upvotes),
          snapshot_date: row.latest.clone(),
          in_library: in_library.contains(&row.arxiv_id),
          later: row.later,
          hidden: row.hidden,
        },
      },
    ));
  }
  scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
  scored.into_iter().map(|(_, item)| item).collect()
}

#[tauri::command]
pub async fn radar_generate_digest(state: State<'_, AppState>, kind: String, anchor_date: Option<String>) -> Result<RadarDigest> {
  let kind = if kind == "weekly" { "weekly" } else { "daily" };
  let radar = open_radar_pool(&state.library_dir).await?;
  let settings = load_settings(&radar).await?;
  if !settings.enabled {
    radar.close().await;
    return Err("请先在设置中启用论文雷达".into());
  }
  let end = anchor_date.unwrap_or_else(today);
  let end_date = chrono::NaiveDate::parse_from_str(&end, "%Y-%m-%d").map_err(err)?;
  let (start, coverage_days, papers) = if kind == "daily" {
    let papers = digest_papers(&radar, &end, &end).await?;
    (end.clone(), if papers.is_empty() { 0 } else { 1 }, papers)
  } else {
    let start = (end_date - chrono::Duration::days(6)).to_string();
    let coverage: i64 = sqlx::query_scalar(
      "SELECT COUNT(DISTINCT snapshot_date) FROM radar_snapshots WHERE snapshot_date>=? AND snapshot_date<=? AND feed='hot'",
    )
    .bind(&start)
    .bind(&end)
    .fetch_one(&radar)
    .await
    .map_err(err)?;
    let papers = digest_papers(&radar, &start, &end).await?;
    (start, coverage, papers)
  };
  if papers.len() < 2 {
    radar.close().await;
    return Err("可用论文不足，无法生成综述".into());
  }
  let llm = load_llm_settings(&*state.pool.read().await).await?;
  let mut clusters_map: HashMap<String, Vec<(String, String, String)>> = HashMap::new();
  for (id, title, abstract_text, category) in &papers {
    clusters_map
      .entry(category.clone())
      .or_default()
      .push((id.clone(), title.clone(), abstract_text.clone()));
  }
  let mut cluster_docs = Vec::new();
  for (theme, members) in clusters_map.into_iter().take(6) {
    let feed = members
      .iter()
      .take(8)
      .map(|(id, title, abs)| format!("- [{id}] {title}：{}", abs.chars().take(220).collect::<String>()))
      .collect::<Vec<_>>()
      .join("\n");
    let raw = llm_completion(
      &llm,
      "你是学术趋势分析师。用简体中文归纳同主题论文：给出不超过12字的主题名 theme，再用2-4句概括。只输出 JSON：{\"theme\":\"…\",\"summary\":\"…\"}。",
      serde_json::Value::String(format!("默认主题：{theme}\n{feed}")),
    )
    .await
    .unwrap_or_default();
    let parsed = json_from_llm(&raw).unwrap_or_else(|_| serde_json::json!({"theme": theme, "summary": ""}));
    cluster_docs.push(RadarDigestCluster {
      theme: parsed.get("theme").and_then(|v| v.as_str()).unwrap_or(&theme).to_string(),
      summary: parsed.get("summary").and_then(|v| v.as_str()).unwrap_or("").to_string(),
      papers: members
        .into_iter()
        .map(|(id, title, _)| RadarDigestPaperRef { id, title })
        .collect(),
    });
  }
  let overview_feed = cluster_docs
    .iter()
    .map(|c| format!("- 主题「{}」：{}", c.theme, c.summary))
    .collect::<Vec<_>>()
    .join("\n");
  let overview = llm_completion(
    &llm,
    "你是学术趋势分析师。根据主题分组写2-3句简体中文总览。只输出纯文本。",
    serde_json::Value::String(overview_feed),
  )
  .await
  .unwrap_or_default();
  let digest = RadarDigest {
    anchor_date: end.clone(),
    kind: kind.into(),
    window_start: Some(start.clone()),
    window_end: Some(end.clone()),
    coverage_days,
    overview: overview.trim().to_string(),
    clusters: cluster_docs,
    paper_count: papers.len() as i64,
    model: Some(llm.model.clone()),
  };
  sqlx::query(
    "INSERT INTO radar_digests(anchor_date,kind,window_start,window_end,coverage_days,model,content_json,paper_count,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(anchor_date,kind) DO UPDATE SET
       window_start=excluded.window_start, window_end=excluded.window_end, coverage_days=excluded.coverage_days,
       model=excluded.model, content_json=excluded.content_json, paper_count=excluded.paper_count, created_at=excluded.created_at",
  )
  .bind(&digest.anchor_date)
  .bind(&digest.kind)
  .bind(&start)
  .bind(&end)
  .bind(coverage_days)
  .bind(&llm.model)
  .bind(serde_json::to_string(&digest).map_err(err)?)
  .bind(digest.paper_count)
  .bind(Utc::now().to_rfc3339())
  .execute(&radar)
  .await
  .map_err(err)?;
  radar.close().await;
  Ok(digest)
}

async fn digest_papers(pool: &SqlitePool, start: &str, end: &str) -> Result<Vec<(String, String, String, String)>> {
  let rows = sqlx::query(
    "SELECT p.arxiv_id, COALESCE(p.title,a.title,p.arxiv_id) AS title,
            COALESCE(p.abstract_text,a.summary_text,'') AS abstract_text,
            COALESCE(p.primary_category,'其他') AS category,
            COALESCE(MAX(s.upvotes),0) AS upvotes
     FROM radar_snapshots s
     JOIN radar_papers p ON p.arxiv_id=s.arxiv_id
     LEFT JOIN radar_ai_summaries a ON a.arxiv_id=s.arxiv_id
     WHERE s.feed='hot' AND s.snapshot_date>=? AND s.snapshot_date<=?
     GROUP BY p.arxiv_id
     ORDER BY upvotes DESC",
  )
  .bind(start)
  .bind(end)
  .fetch_all(pool)
  .await
  .map_err(err)?;
  Ok(rows
    .into_iter()
    .map(|row| -> (String, String, String, String) {
      (
        row.get("arxiv_id"),
        row.get("title"),
        row.get("abstract_text"),
        row.get("category"),
      )
    })
    .filter(|(_, _, abs, _)| !abs.trim().is_empty())
    .collect())
}

#[tauri::command]
pub async fn radar_get_digest(state: State<'_, AppState>, kind: String, anchor_date: String) -> Result<Option<RadarDigest>> {
  let radar = open_radar_pool(&state.library_dir).await?;
  let kind = if kind == "weekly" { "weekly" } else { "daily" };
  let raw: Option<String> = sqlx::query_scalar("SELECT content_json FROM radar_digests WHERE anchor_date=? AND kind=?")
    .bind(&anchor_date)
    .bind(kind)
    .fetch_optional(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  Ok(raw.and_then(|value| serde_json::from_str(&value).ok()))
}

#[tauri::command]
pub async fn radar_explain_paper(state: State<'_, AppState>, arxiv_id: String) -> Result<RadarExplanation> {
  let id = clean_arxiv_id(&arxiv_id);
  if id.is_empty() {
    return Err("无效 arXiv ID".into());
  }
  let radar = open_radar_pool(&state.library_dir).await?;
  if let Some(raw) = sqlx::query_scalar::<_, String>("SELECT content_json FROM radar_explanations WHERE arxiv_id=?")
    .bind(&id)
    .fetch_optional(&radar)
    .await
    .map_err(err)?
  {
    if let Ok(cached) = serde_json::from_str::<RadarExplanation>(&raw) {
      if explanation_is_rich(&cached) {
        radar.close().await;
        return Ok(cached);
      }
    }
  }
  let row = sqlx::query(
    "SELECT COALESCE(p.title,a.title,'') AS title,
            COALESCE(p.abstract_text,'') AS abstract_text,
            COALESCE(a.summary_text,'') AS ai_summary
     FROM radar_papers p LEFT JOIN radar_ai_summaries a ON a.arxiv_id=p.arxiv_id WHERE p.arxiv_id=?",
  )
  .bind(&id)
  .fetch_optional(&radar)
  .await
  .map_err(err)?
  .ok_or_else(|| "雷达库中没有这篇论文".to_string())?;
  let title: String = row.get("title");
  let abstract_text: String = row.get("abstract_text");
  let ai_summary: String = row.get("ai_summary");
  radar.close().await;
  // 解读输入优先完整英文摘要；alphaxiv tl;dr 仅作摘要缺失时的回退（避免对短 tl;dr 再压缩）
  let source_en = if abstract_text.trim().len() >= 80 {
    abstract_text.trim().to_string()
  } else if ai_summary.trim().len() >= 40 {
    ai_summary.trim().to_string()
  } else {
    abstract_text.trim().to_string()
  };
  if source_en.is_empty() {
    return Err("缺少摘要，无法解读".into());
  }
  let llm = load_llm_settings(&*state.pool.read().await).await?;
  let source_clip: String = source_en.chars().take(1800).collect();
  let raw = llm_completion_opts(
    &llm,
    "你是学术研读助手。根据标题与英文摘要，用简体中文生成结构化解读，专有名词可保留英文。只输出 JSON：{\"titleZh\":\"中文标题\",\"abstractZh\":\"中文摘要（忠实翻译，可适度压缩）\",\"summaryZh\":\"一句话总结\",\"problem\":\"研究问题\",\"method\":\"方法与思路\",\"finding\":\"主要结论或贡献\",\"highlight\":\"亮点、局限或开源信息\"}。titleZh/summaryZh 各不超过40字；abstractZh 不超过320字；problem/method/finding/highlight 各不超过120字。不要输出 markdown 代码块。",
    serde_json::Value::String(format!("标题：{title}\n\n摘要：{source_clip}")),
    Some(1800),
    120,
  )
  .await
  .map_err(|error| format!("解读请求失败：{error}"))?;
  let parsed = json_from_llm(&raw)?;
  let explanation = RadarExplanation {
    arxiv_id: id.clone(),
    title_en: Some(title.clone()).filter(|v| !v.trim().is_empty()),
    title_zh: parsed.get("titleZh").and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty()).map(str::to_string),
    abstract_en: Some(abstract_text.clone()).filter(|v| !v.trim().is_empty())
      .or_else(|| Some(source_en.clone()).filter(|v| !v.trim().is_empty())),
    abstract_zh: parsed.get("abstractZh").and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty()).map(str::to_string),
    summary_zh: parsed.get("summaryZh").and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty()).map(str::to_string),
    problem: parsed.get("problem").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
    method: parsed.get("method").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
    finding: parsed.get("finding").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
    highlight: parsed.get("highlight").and_then(|v| v.as_str()).unwrap_or("").trim().to_string(),
    model: Some(llm.model.clone()),
  };
  let radar = open_radar_pool(&state.library_dir).await?;
  sqlx::query("INSERT INTO radar_explanations(arxiv_id,content_json,model,created_at) VALUES(?,?,?,?) ON CONFLICT(arxiv_id) DO UPDATE SET content_json=excluded.content_json, model=excluded.model, created_at=excluded.created_at")
    .bind(&id)
    .bind(serde_json::to_string(&explanation).map_err(err)?)
    .bind(&llm.model)
    .bind(Utc::now().to_rfc3339())
    .execute(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  Ok(explanation)
}

#[tauri::command]
pub async fn radar_get_explanation(state: State<'_, AppState>, arxiv_id: String) -> Result<Option<RadarExplanation>> {
  let id = clean_arxiv_id(&arxiv_id);
  if id.is_empty() {
    return Err("无效 arXiv ID".into());
  }
  let radar = open_radar_pool(&state.library_dir).await?;
  let raw: Option<String> = sqlx::query_scalar("SELECT content_json FROM radar_explanations WHERE arxiv_id=?")
    .bind(&id)
    .fetch_optional(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  Ok(raw.and_then(|value| {
    serde_json::from_str::<RadarExplanation>(&value)
      .ok()
      .filter(explanation_is_rich)
  }))
}

#[tauri::command]
pub async fn radar_list_explained_ids(state: State<'_, AppState>) -> Result<Vec<String>> {
  let radar = open_radar_pool(&state.library_dir).await?;
  let rows = sqlx::query("SELECT arxiv_id, content_json FROM radar_explanations")
    .fetch_all(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  let mut ids = Vec::new();
  for row in rows {
    let id: String = row.get("arxiv_id");
    let raw: String = row.get("content_json");
    if serde_json::from_str::<RadarExplanation>(&raw)
      .ok()
      .filter(explanation_is_rich)
      .is_some()
    {
      ids.push(id);
    }
  }
  Ok(ids)
}

#[tauri::command]
pub async fn radar_delete_explanation(state: State<'_, AppState>, arxiv_id: String) -> Result<()> {
  let id = clean_arxiv_id(&arxiv_id);
  if id.is_empty() {
    return Err("无效 arXiv ID".into());
  }
  let radar = open_radar_pool(&state.library_dir).await?;
  sqlx::query("DELETE FROM radar_explanations WHERE arxiv_id=?")
    .bind(&id)
    .execute(&radar)
    .await
    .map_err(err)?;
  radar.close().await;
  Ok(())
}

#[tauri::command]
pub async fn radar_import_to_library(
  state: State<'_, AppState>,
  arxiv_id: String,
  download_pdf: bool,
  folder_id: Option<String>,
) -> Result<RadarImportResult> {
  let id = clean_arxiv_id(&arxiv_id);
  if id.is_empty() {
    return Err("无效 arXiv ID".into());
  }
  let radar = open_radar_pool(&state.library_dir).await?;
  let settings = load_settings(&radar).await?;
  if !settings.enabled {
    radar.close().await;
    return Err("请先在设置中启用论文雷达".into());
  }
  let row = sqlx::query(
    "SELECT COALESCE(p.title,a.title,'') AS title, p.abstract_text, a.summary_text, p.authors_json, p.published_date, p.abs_url
     FROM radar_papers p LEFT JOIN radar_ai_summaries a ON a.arxiv_id=p.arxiv_id WHERE p.arxiv_id=?",
  )
  .bind(&id)
  .fetch_optional(&radar)
  .await
  .map_err(err)?
  .ok_or_else(|| "雷达库中没有这篇论文，请先推荐今日论文".to_string())?;
  let cached_explain: Option<RadarExplanation> = sqlx::query_scalar::<_, String>(
    "SELECT content_json FROM radar_explanations WHERE arxiv_id=?",
  )
  .bind(&id)
  .fetch_optional(&radar)
  .await
  .map_err(err)?
  .and_then(|raw| serde_json::from_str(&raw).ok());
  radar.close().await;

  let library = state.pool.read().await;
  if let Some(folder) = folder_id.as_ref() {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM folders WHERE id=?")
      .bind(folder)
      .fetch_optional(&*library)
      .await
      .map_err(err)?;
    if exists.is_none() {
      return Err("目标文件夹不存在".into());
    }
  }
  let existing: Option<(String, Option<String>)> = sqlx::query("SELECT id, pdf_path, arxiv_id FROM papers WHERE deleted_at IS NULL AND arxiv_id IS NOT NULL")
    .fetch_all(&*library)
    .await
    .map_err(err)?
    .into_iter()
    .find_map(|row| {
      let paper_id: String = row.get("id");
      let arxiv: Option<String> = row.get("arxiv_id");
      let pdf: Option<String> = row.get("pdf_path");
      arxiv
        .as_deref()
        .map(clean_arxiv_id)
        .filter(|value| value == &id)
        .map(|_| (paper_id, pdf))
    });

  let title: String = row.get("title");
  let abstract_text: Option<String> = row
    .get::<Option<String>, _>("abstract_text")
    .filter(|v| !v.trim().is_empty())
    .or_else(|| row.get::<Option<String>, _>("summary_text"));
  let authors: Vec<String> = serde_json::from_str(&row.get::<Option<String>, _>("authors_json").unwrap_or_else(|| "[]".into())).unwrap_or_default();
  let published: Option<String> = row.get("published_date");
  let abs_url: Option<String> = row.get("abs_url");

  if let Some((paper_id, pdf_path)) = existing {
    if download_pdf && pdf_path.as_deref().unwrap_or("").is_empty() {
      let rel = download_arxiv_pdf(&state.library_dir, &id).await?;
      sqlx::query("UPDATE papers SET pdf_path=?, updated_at=? WHERE id=?")
        .bind(&rel)
        .bind(Utc::now().to_rfc3339())
        .bind(&paper_id)
        .execute(&*library)
        .await
        .map_err(err)?;
      let paper = row_paper(sqlx::query("SELECT * FROM papers WHERE id=?").bind(&paper_id).fetch_one(&*library).await.map_err(err)?)?;
      return Ok(RadarImportResult {
        paper,
        downloaded_pdf: true,
        already_in_library: true,
      });
    }
    let paper = row_paper(sqlx::query("SELECT * FROM papers WHERE id=?").bind(&paper_id).fetch_one(&*library).await.map_err(err)?)?;
    return Ok(RadarImportResult {
      paper,
      downloaded_pdf: false,
      already_in_library: true,
    });
  }

  let mut paper = blank_paper(if title.is_empty() { id.clone() } else { title });
  paper.arxiv_id = Some(id.clone());
  paper.abstract_en = abstract_text;
  if let Some(expl) = cached_explain.as_ref() {
    if let Some(title_zh) = expl.title_zh.clone().filter(|v| !v.trim().is_empty()) {
      paper.title_zh = Some(title_zh);
    }
    if let Some(abstract_zh) = expl.abstract_zh.clone().filter(|v| !v.trim().is_empty()) {
      paper.abstract_zh = Some(abstract_zh);
    }
    if let Some(summary_zh) = expl.summary_zh.clone().filter(|v| !v.trim().is_empty()) {
      paper.summary = Some(summary_zh);
    } else if !expl.problem.is_empty() {
      paper.summary = Some(expl.problem.clone());
    }
  }
  paper.authors = authors
    .into_iter()
    .map(|name| Author {
      id: Uuid::new_v4().to_string(),
      name,
    })
    .collect();
  paper.publication_date = published;
  paper.source_url = abs_url.or(Some(format!("https://arxiv.org/abs/{id}")));
  paper.folder_id = folder_id;
  paper.status = "unread".into();
  let mut downloaded = false;
  if download_pdf {
    let rel = download_arxiv_pdf(&state.library_dir, &id).await?;
    paper.pdf_path = Some(rel);
    downloaded = true;
  }
  put_paper(&library, &paper).await?;
  Ok(RadarImportResult {
    paper,
    downloaded_pdf: downloaded,
    already_in_library: false,
  })
}

async fn download_arxiv_pdf(library_dir: &Path, arxiv_id: &str) -> Result<String> {
  let client = Client::builder().timeout(Duration::from_secs(90)).build().map_err(err)?;
  let url = format!("https://arxiv.org/pdf/{arxiv_id}.pdf");
  let response = client
    .get(&url)
    .header("User-Agent", "PaperNest-Radar/0.2.1")
    .send()
    .await
    .map_err(err)?;
  if !response.status().is_success() {
    return Err(format!("下载 PDF 失败（{}）", response.status()));
  }
  let bytes = response.bytes().await.map_err(err)?;
  if bytes.len() < 1000 {
    return Err("下载的 PDF 过小，可能不是有效文件".into());
  }
  let id = Uuid::new_v4().to_string();
  let rel = format!("pdf/originals/{id}.pdf");
  fs::create_dir_all(library_dir.join("pdf/originals")).map_err(err)?;
  fs::write(library_dir.join(&rel), &bytes).map_err(err)?;
  Ok(rel)
}

#[cfg(test)]
mod radar_unit_tests {
  use super::*;

  #[test]
  fn clean_arxiv_id_from_url_and_version() {
    assert_eq!(clean_arxiv_id("https://arxiv.org/abs/2608.23552v1"), "2608.23552");
    assert_eq!(clean_arxiv_id("2608.23552"), "2608.23552");
  }

  #[test]
  fn parse_arxiv_atom_extracts_entry() {
    let xml = r#"<?xml version="1.0"?>
<entry>
  <id>http://arxiv.org/abs/1234.56789v1</id>
  <title>Hello World</title>
  <summary>An abstract.</summary>
  <published>2026-01-01T00:00:00Z</published>
  <author><name>Ada</name></author>
  <category term="cs.LG" />
</entry>"#;
    let parsed = parse_arxiv_atom(xml);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].0, "1234.56789");
    assert_eq!(parsed[0].1, "Hello World");
  }

  #[test]
  fn interest_match_keywords_and_unknown_category_passes() {
    let keywords = vec!["agent skill".into()];
    let subscribed = vec!["cs.AI".into()];
    assert!(interest_match(
      &keywords,
      &subscribed,
      "Learning Agent Skills for Robotics",
      Some("We train agents with reusable skills."),
      None,
      None,
      &[],
      &[],
    ));
    assert!(!interest_match(
      &keywords,
      &subscribed,
      "Database Index Structures",
      Some("B-tree optimization."),
      None,
      None,
      &[],
      &[],
    ));
  }

  #[test]
  fn category_matches_subscribed_cs_label() {
    assert!(category_matches(
      &["cs.CL".into()],
      Some("cs.CL"),
      &[],
      &["NLP".into()],
    ));
  }

  #[test]
  fn cosine_similarity_identical_is_one() {
    let v = vec![1.0_f32, 0.0, 0.0];
    assert!((cosine_similarity(&v, &v) - 1.0).abs() < 1e-6);
  }

  #[test]
  fn embedding_text_hash_stable() {
    assert_eq!(embedding_text_hash("agent skill"), embedding_text_hash("agent skill"));
    assert_ne!(embedding_text_hash("agent skill"), embedding_text_hash("skill learning"));
  }

  #[test]
  fn interest_query_includes_keyword_cats_and_date() {
    let q = build_interest_query("agent memory", &["cs.AI".into(), "cs.CL".into()], 3);
    assert!(q.contains("ti:\"agent memory\""));
    assert!(q.contains("abs:\"agent memory\""));
    assert!(q.contains("cat:cs.AI"));
    assert!(q.contains("cat:cs.CL"));
    assert!(q.contains("submittedDate:["));
  }

  #[test]
  fn parse_arxiv_atom_keeps_all_categories() {
    let xml = r#"<?xml version="1.0"?>
<entry>
  <id>http://arxiv.org/abs/1234.56789v1</id>
  <title>Hello World</title>
  <summary>An abstract.</summary>
  <published>2026-01-01T00:00:00Z</published>
  <author><name>Ada</name></author>
  <category term="cs.LG" />
  <category term="cs.AI" />
</entry>"#;
    let parsed = parse_arxiv_atom(xml);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].4, vec!["cs.LG".to_string(), "cs.AI".to_string()]);
    assert_eq!(parsed[0].5.as_deref(), Some("cs.LG"));
  }

  #[tokio::test]
  async fn interest_and_new_network_smoke() {
    let cats = vec!["cs.AI".into(), "cs.CL".into(), "cs.LG".into()];
    let new_cards = fetch_arxiv_new(&cats, 20, None).await.expect("new fetch");
    assert!(!new_cards.is_empty(), "New 日窗应返回稿件");

    tokio::time::sleep(Duration::from_millis(3100)).await;
    let interest = fetch_arxiv_interest(&["agent memory".into()], &cats, None)
      .await
      .expect("interest fetch");
    assert!(!interest.is_empty(), "Interest 关键词召回应返回稿件");
    let new_ids: HashSet<_> = new_cards.iter().map(|e| e.0.clone()).collect();
    let exclusive = interest.iter().filter(|e| !new_ids.contains(&e.0)).count();
    assert!(
      exclusive > 0,
      "Interest 应找回 New Top-20 之外的相关稿（exclusive={exclusive}, interest={}, new={}）",
      interest.len(),
      new_cards.len()
    );
  }

  #[tokio::test]
  async fn three_path_writes_interest_snapshots() {
    let dir = std::env::temp_dir().join(format!("papernest-radar-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).expect("temp dir");
    let pool = open_radar_pool(&dir).await.expect("open radar");
    let date = today();
    let cats = vec!["cs.AI".into(), "cs.CL".into(), "cs.LG".into()];

    let hot = fetch_alphaxiv_hot(10).await.unwrap_or_default();
    for (index, (arxiv_id, title, summary, tags, upvotes)) in hot.into_iter().enumerate() {
      upsert_paper_meta(&pool, &arxiv_id, &title, None, &[], None, &[], None)
        .await
        .unwrap();
      upsert_ai_summary(&pool, &arxiv_id, Some(&title), summary.as_deref(), &tags)
        .await
        .unwrap();
      insert_snapshot(&pool, &date, &arxiv_id, "hot", (index + 1) as i64, upvotes)
        .await
        .unwrap();
    }

    tokio::time::sleep(Duration::from_millis(3100)).await;
    let news = fetch_arxiv_new(&cats, 15, None).await.expect("new");
    for (index, (arxiv_id, title, summary, authors, categories, primary, published)) in news.into_iter().enumerate() {
      upsert_paper_meta(
        &pool,
        &arxiv_id,
        &title,
        Some(&summary),
        &authors,
        primary.as_deref(),
        &categories,
        published.as_deref(),
      )
      .await
      .unwrap();
      insert_snapshot(&pool, &date, &arxiv_id, "new", (index + 1) as i64, None)
        .await
        .unwrap();
    }

    tokio::time::sleep(Duration::from_millis(3100)).await;
    let interest = fetch_arxiv_interest(&["agent memory".into()], &cats, None)
      .await
      .expect("interest");
    assert!(!interest.is_empty());
    for (index, (arxiv_id, title, summary, authors, categories, primary, published)) in interest.into_iter().enumerate() {
      upsert_paper_meta(
        &pool,
        &arxiv_id,
        &title,
        Some(&summary),
        &authors,
        primary.as_deref(),
        &categories,
        published.as_deref(),
      )
      .await
      .unwrap();
      insert_snapshot(&pool, &date, &arxiv_id, "interest", (index + 1) as i64, None)
        .await
        .unwrap();
    }

    let interest_count: i64 = sqlx::query_scalar(
      "SELECT COUNT(*) FROM radar_snapshots WHERE snapshot_date=? AND feed='interest'",
    )
    .bind(&date)
    .fetch_one(&pool)
    .await
    .unwrap();
    let new_count: i64 = sqlx::query_scalar(
      "SELECT COUNT(*) FROM radar_snapshots WHERE snapshot_date=? AND feed='new'",
    )
    .bind(&date)
    .fetch_one(&pool)
    .await
    .unwrap();
    pool.close().await;
    let _ = fs::remove_dir_all(&dir);
    assert!(interest_count > 0, "应写入 interest 快照");
    assert!(new_count > 0, "应写入 new 快照");
  }

  #[test]
  fn explanation_richness_requires_zh_fields() {
    let thin = RadarExplanation {
      arxiv_id: "1".into(),
      title_en: None,
      title_zh: None,
      abstract_en: None,
      abstract_zh: None,
      summary_zh: None,
      problem: "p".into(),
      method: "m".into(),
      finding: "f".into(),
      highlight: "h".into(),
      model: None,
    };
    assert!(!explanation_is_rich(&thin));
    let fast_only = RadarExplanation {
      title_zh: Some("中文标题".into()),
      summary_zh: Some("一句话".into()),
      problem: "研究问题足够长".into(),
      ..thin.clone()
    };
    assert!(!explanation_is_rich(&fast_only));
    let rich = RadarExplanation {
      title_zh: Some("中文标题".into()),
      summary_zh: Some("一句话".into()),
      abstract_zh: Some("中文摘要若干字".into()),
      problem: "本文研究何种问题及其背景动机".into(),
      ..thin
    };
    assert!(explanation_is_rich(&rich));
  }
}
