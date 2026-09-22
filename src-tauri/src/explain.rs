use super::*;
use crate::search_query::fts_query;
use std::collections::HashSet;

const OVERVIEW_CHAR_BUDGET: usize = 90_000;
const ASK_FULL_CHAR_BUDGET: usize = 45_000;
const ASK_RETRIEVED_CHAR_BUDGET: usize = 36_000;
const ASK_HISTORY_TURNS: usize = 12;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperExplainOverview {
  pub summary: String,
  pub problem: String,
  pub method: String,
  pub findings: String,
  pub limits: String,
  pub reading_tips: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperExplainMessage {
  pub role: String,
  pub content: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub cites: Option<Vec<i64>>,
  pub created_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperExplainChatSummary {
  pub id: String,
  pub title: String,
  pub updated_at: String,
  pub message_count: i64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperExplainSession {
  pub paper_id: String,
  pub locale: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub overview: Option<PaperExplainOverview>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub chat_id: Option<String>,
  pub messages: Vec<PaperExplainMessage>,
  #[serde(default)]
  pub chats: Vec<PaperExplainChatSummary>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub model: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub updated_at: Option<String>,
}

#[derive(Clone)]
struct PageTextRow {
  page: i64,
  text: String,
}

fn empty_session(paper_id: &str) -> PaperExplainSession {
  PaperExplainSession {
    paper_id: paper_id.to_string(),
    locale: "zh-CN".into(),
    overview: None,
    chat_id: None,
    messages: Vec::new(),
    chats: Vec::new(),
    model: None,
    updated_at: None,
  }
}

fn parse_messages(raw: &str) -> Result<Vec<PaperExplainMessage>> {
  if raw.trim().is_empty() {
    return Ok(Vec::new());
  }
  serde_json::from_str(raw).map_err(err)
}

fn parse_overview(raw: Option<&str>) -> Result<Option<PaperExplainOverview>> {
  let Some(text) = raw.map(str::trim).filter(|v| !v.is_empty()) else {
    return Ok(None);
  };
  Ok(Some(serde_json::from_str(text).map_err(err)?))
}

fn title_from_question(question: &str) -> String {
  let trimmed = question.trim().replace('\n', " ");
  let mut chars = trimmed.chars();
  let short: String = chars.by_ref().take(28).collect();
  if chars.next().is_some() {
    format!("{short}…")
  } else if short.is_empty() {
    "新对话".into()
  } else {
    short
  }
}

fn message_count(messages: &[PaperExplainMessage]) -> i64 {
  messages.len() as i64
}

/// 把旧版写在 paper_explains.messages_json 里的对话迁到 paper_explain_chats。
pub async fn migrate_legacy_explain_chats(pool: &SqlitePool) -> Result<()> {
  let rows = sqlx::query(
    "SELECT paper_id, messages_json, model, updated_at FROM paper_explains
     WHERE messages_json IS NOT NULL AND trim(messages_json) != '' AND trim(messages_json) != '[]'",
  )
  .fetch_all(pool)
  .await
  .map_err(err)?;
  for row in rows {
    let paper_id: String = row.get("paper_id");
    let existing: i64 = sqlx::query_scalar("SELECT COUNT(1) FROM paper_explain_chats WHERE paper_id=?")
      .bind(&paper_id)
      .fetch_one(pool)
      .await
      .map_err(err)?;
    if existing > 0 {
      sqlx::query("UPDATE paper_explains SET messages_json='[]' WHERE paper_id=?")
        .bind(&paper_id)
        .execute(pool)
        .await
        .map_err(err)?;
      continue;
    }
    let messages_raw: String = row.get("messages_json");
    let messages = parse_messages(&messages_raw)?;
    if messages.is_empty() {
      continue;
    }
    let chat_id = Uuid::new_v4().to_string();
    let title = messages
      .iter()
      .find(|item| item.role == "user")
      .map(|item| title_from_question(&item.content))
      .unwrap_or_else(|| "对话 1".into());
    let updated_at: String = row.get("updated_at");
    let model: Option<String> = row.get("model");
    sqlx::query(
      "INSERT INTO paper_explain_chats(id,paper_id,title,messages_json,model,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?)",
    )
    .bind(&chat_id)
    .bind(&paper_id)
    .bind(&title)
    .bind(serde_json::to_string(&messages).map_err(err)?)
    .bind(model)
    .bind(&updated_at)
    .bind(&updated_at)
    .execute(pool)
    .await
    .map_err(err)?;
    sqlx::query("UPDATE paper_explains SET active_chat_id=?, messages_json='[]' WHERE paper_id=?")
      .bind(&chat_id)
      .bind(&paper_id)
      .execute(pool)
      .await
      .map_err(err)?;
  }
  Ok(())
}

async fn list_chat_summaries(pool: &SqlitePool, paper_id: &str) -> Result<Vec<PaperExplainChatSummary>> {
  let rows = sqlx::query(
    "SELECT id, title, messages_json, updated_at FROM paper_explain_chats WHERE paper_id=? ORDER BY updated_at DESC",
  )
  .bind(paper_id)
  .fetch_all(pool)
  .await
  .map_err(err)?;
  let mut chats = Vec::with_capacity(rows.len());
  for row in rows {
    let messages = parse_messages(&row.get::<String, _>("messages_json"))?;
    chats.push(PaperExplainChatSummary {
      id: row.get("id"),
      title: row.get("title"),
      updated_at: row.get("updated_at"),
      message_count: message_count(&messages),
    });
  }
  Ok(chats)
}

async fn load_chat_messages(pool: &SqlitePool, chat_id: &str) -> Result<Vec<PaperExplainMessage>> {
  let raw: Option<String> = sqlx::query_scalar("SELECT messages_json FROM paper_explain_chats WHERE id=?")
    .bind(chat_id)
    .fetch_optional(pool)
    .await
    .map_err(err)?;
  match raw {
    Some(text) => parse_messages(&text),
    None => Err("对话不存在".into()),
  }
}

async fn create_chat(pool: &SqlitePool, paper_id: &str, title: &str) -> Result<String> {
  let chat_id = Uuid::new_v4().to_string();
  let now = Utc::now().to_rfc3339();
  sqlx::query(
    "INSERT INTO paper_explain_chats(id,paper_id,title,messages_json,model,created_at,updated_at)
     VALUES(?,?,?,'[]',NULL,?,?)",
  )
  .bind(&chat_id)
  .bind(paper_id)
  .bind(title)
  .bind(&now)
  .bind(&now)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(chat_id)
}

async fn set_active_chat(pool: &SqlitePool, paper_id: &str, chat_id: Option<&str>) -> Result<()> {
  sqlx::query("UPDATE paper_explains SET active_chat_id=?, updated_at=? WHERE paper_id=?")
    .bind(chat_id)
    .bind(Utc::now().to_rfc3339())
    .bind(paper_id)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

async fn save_chat_messages(
  pool: &SqlitePool,
  chat_id: &str,
  messages: &[PaperExplainMessage],
  model: Option<&str>,
  title: Option<&str>,
) -> Result<()> {
  let now = Utc::now().to_rfc3339();
  if let Some(title) = title {
    sqlx::query(
      "UPDATE paper_explain_chats SET messages_json=?, model=?, title=?, updated_at=? WHERE id=?",
    )
    .bind(serde_json::to_string(messages).map_err(err)?)
    .bind(model)
    .bind(title)
    .bind(&now)
    .bind(chat_id)
    .execute(pool)
    .await
    .map_err(err)?;
  } else {
    sqlx::query("UPDATE paper_explain_chats SET messages_json=?, model=?, updated_at=? WHERE id=?")
      .bind(serde_json::to_string(messages).map_err(err)?)
      .bind(model)
      .bind(&now)
      .bind(chat_id)
      .execute(pool)
      .await
      .map_err(err)?;
  }
  Ok(())
}

async fn upsert_overview(
  pool: &SqlitePool,
  paper_id: &str,
  locale: &str,
  overview: Option<&PaperExplainOverview>,
  model: Option<&str>,
  active_chat_id: Option<&str>,
) -> Result<()> {
  let overview_json = overview.map(serde_json::to_string).transpose().map_err(err)?;
  let updated_at = Utc::now().to_rfc3339();
  sqlx::query(
    "INSERT INTO paper_explains(paper_id,locale,overview_json,messages_json,active_chat_id,model,updated_at)
     VALUES(?,?,?,'[]',?,?,?)
     ON CONFLICT(paper_id) DO UPDATE SET
       locale=excluded.locale,
       overview_json=excluded.overview_json,
       active_chat_id=COALESCE(excluded.active_chat_id, paper_explains.active_chat_id),
       model=excluded.model,
       updated_at=excluded.updated_at",
  )
  .bind(paper_id)
  .bind(locale)
  .bind(overview_json)
  .bind(active_chat_id)
  .bind(model)
  .bind(updated_at)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

async fn load_session(pool: &SqlitePool, paper_id: &str) -> Result<PaperExplainSession> {
  let row = sqlx::query(
    "SELECT paper_id, locale, overview_json, active_chat_id, model, updated_at FROM paper_explains WHERE paper_id=?",
  )
  .bind(paper_id)
  .fetch_optional(pool)
  .await
  .map_err(err)?;
  let Some(row) = row else {
    return Ok(empty_session(paper_id));
  };
  let overview = parse_overview(row.get::<Option<String>, _>("overview_json").as_deref())?;
  let mut active_chat_id: Option<String> = row.get("active_chat_id");
  let mut chats = list_chat_summaries(pool, paper_id).await?;
  if overview.is_some() && chats.is_empty() {
    let chat_id = create_chat(pool, paper_id, "新对话").await?;
    set_active_chat(pool, paper_id, Some(&chat_id)).await?;
    active_chat_id = Some(chat_id);
    chats = list_chat_summaries(pool, paper_id).await?;
  } else if let Some(id) = active_chat_id.clone() {
    if !chats.iter().any(|item| item.id == id) {
      active_chat_id = chats.first().map(|item| item.id.clone());
      set_active_chat(pool, paper_id, active_chat_id.as_deref()).await?;
    }
  } else if let Some(first) = chats.first() {
    active_chat_id = Some(first.id.clone());
    set_active_chat(pool, paper_id, active_chat_id.as_deref()).await?;
  }
  let messages = match active_chat_id.as_deref() {
    Some(id) => load_chat_messages(pool, id).await?,
    None => Vec::new(),
  };
  Ok(PaperExplainSession {
    paper_id: row.get("paper_id"),
    locale: row.get("locale"),
    overview,
    chat_id: active_chat_id,
    messages,
    chats,
    model: row.get("model"),
    updated_at: row.get("updated_at"),
  })
}

async fn load_pages(pool: &SqlitePool, paper_id: &str) -> Result<Vec<PageTextRow>> {
  let rows = sqlx::query("SELECT page, text FROM pdf_pages WHERE paper_id=? ORDER BY page")
    .bind(paper_id)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("读取论文页文失败：{error}"))?;
  Ok(
    rows
      .into_iter()
      .map(|row| PageTextRow {
        page: row.get("page"),
        text: row.get::<String, _>("text").replace('\u{0000}', " "),
      })
      .filter(|row| !row.text.trim().is_empty())
      .collect(),
  )
}

async fn load_paper_meta(pool: &SqlitePool, paper_id: &str) -> Result<(String, String, String)> {
  let row = sqlx::query(
    "SELECT COALESCE(title_zh, title_en, '') AS title,
            COALESCE(abstract_zh, '') AS abstract_zh,
            COALESCE(abstract_en, summary, '') AS abstract_en
     FROM papers WHERE id=? AND deleted_at IS NULL",
  )
  .bind(paper_id)
  .fetch_optional(pool)
  .await
  .map_err(err)?
  .ok_or_else(|| "论文不存在".to_string())?;
  Ok((row.get("title"), row.get("abstract_zh"), row.get("abstract_en")))
}

fn page_priority(page: i64, text: &str) -> i32 {
  let lower = text.to_ascii_lowercase();
  let mut score = 0;
  if page <= 8 {
    score += 8 - page as i32;
  }
  for key in [
    "abstract",
    "introduction",
    "related work",
    "method",
    "approach",
    "experiment",
    "conclusion",
    "limitation",
    "摘要",
    "引言",
    "方法",
    "实验",
    "结论",
  ] {
    if lower.contains(key) {
      score += 5;
    }
  }
  score
}

/// 在字符预算内选取页文：优先前几页与含章节关键词的页，再均匀补页。
pub(crate) fn select_pages_for_budget(pages: &[(i64, String)], budget: usize) -> Vec<(i64, String)> {
  if pages.is_empty() || budget == 0 {
    return Vec::new();
  }
  let total: usize = pages.iter().map(|(_, text)| text.chars().count() + 12).sum();
  if total <= budget {
    return pages.to_vec();
  }

  let mut ranked: Vec<(usize, i32)> = pages
    .iter()
    .enumerate()
    .map(|(index, (page, text))| (index, page_priority(*page, text)))
    .collect();
  ranked.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));

  let mut chosen = HashSet::new();
  let mut used = 0usize;
  let mut out_order: Vec<usize> = Vec::new();

  for (index, _) in &ranked {
    let text = &pages[*index].1;
    let cost = text.chars().count() + 12;
    if used + cost > budget && !out_order.is_empty() {
      continue;
    }
    chosen.insert(*index);
    out_order.push(*index);
    used += cost;
    if used >= budget {
      break;
    }
  }

  if used < budget {
    let step = ((pages.len() as f64) / 8.0).ceil().max(1.0) as usize;
    for index in (0..pages.len()).step_by(step) {
      if chosen.contains(&index) {
        continue;
      }
      let cost = pages[index].1.chars().count() + 12;
      if used + cost > budget {
        continue;
      }
      chosen.insert(index);
      out_order.push(index);
      used += cost;
    }
  }

  out_order.sort_unstable();
  out_order
    .into_iter()
    .map(|index| pages[index].clone())
    .collect()
}

fn format_pages(pages: &[(i64, String)]) -> String {
  pages
    .iter()
    .map(|(page, text)| format!("【第 {page} 页】\n{}", text.trim()))
    .collect::<Vec<_>>()
    .join("\n\n")
}

fn overview_from_value(value: &serde_json::Value) -> PaperExplainOverview {
  let pick = |keys: &[&str]| -> String {
    for key in keys {
      if let Some(text) = value.get(*key).and_then(|v| v.as_str()).map(str::trim).filter(|v| !v.is_empty()) {
        return text.replace("\\n\\n", "\n\n").replace("\\n", "\n");
      }
    }
    String::new()
  };
  PaperExplainOverview {
    summary: pick(&["summary", "summaryZh"]),
    problem: pick(&["problem"]),
    method: pick(&["method"]),
    findings: pick(&["findings", "finding"]),
    limits: pick(&["limits", "limitations", "highlight"]),
    reading_tips: pick(&["readingTips", "reading_tips"]),
  }
}

fn extract_cites(text: &str) -> Vec<i64> {
  let mut pages = Vec::new();
  let mut seen = HashSet::new();
  let chars: Vec<char> = text.chars().collect();
  let mut i = 0;
  while i < chars.len() {
    let ch = chars[i];
    if ch.eq_ignore_ascii_case(&'p') {
      let mut j = i + 1;
      if j < chars.len() && (chars[j] == '.' || chars[j] == ' ') {
        j += 1;
      }
      let start = j;
      while j < chars.len() && chars[j].is_ascii_digit() {
        j += 1;
      }
      if j > start {
        let digits: String = chars[start..j].iter().collect();
        if let Ok(page) = digits.parse::<i64>() {
          if page > 0 && page < 10_000 && seen.insert(page) {
            pages.push(page);
          }
        }
        i = j;
        continue;
      }
    }
    if ch == '第' {
      let mut j = i + 1;
      while j < chars.len() && chars[j].is_whitespace() {
        j += 1;
      }
      let start = j;
      while j < chars.len() && chars[j].is_ascii_digit() {
        j += 1;
      }
      if j > start {
        let mut k = j;
        while k < chars.len() && chars[k].is_whitespace() {
          k += 1;
        }
        if k < chars.len() && chars[k] == '页' {
          let digits: String = chars[start..j].iter().collect();
          if let Ok(page) = digits.parse::<i64>() {
            if page > 0 && page < 10_000 && seen.insert(page) {
              pages.push(page);
            }
          }
          i = k + 1;
          continue;
        }
      }
    }
    i += 1;
  }
  pages
}

async fn retrieve_pages_for_question(
  pool: &SqlitePool,
  paper_id: &str,
  question: &str,
  all_pages: &[PageTextRow],
) -> Result<Vec<(i64, String)>> {
  let mapped: Vec<(i64, String)> = all_pages
    .iter()
    .map(|row| (row.page, row.text.clone()))
    .collect();
  let total: usize = mapped.iter().map(|(_, text)| text.chars().count()).sum();
  if total <= ASK_FULL_CHAR_BUDGET {
    return Ok(mapped);
  }

  let fts = fts_query(question);
  let mut selected: Vec<(i64, String)> = Vec::new();
  let mut seen = HashSet::new();
  if !fts.is_empty() {
    let rows = sqlx::query(
      "SELECT page, text FROM pdf_search WHERE pdf_search MATCH ? AND paper_id=? ORDER BY bm25(pdf_search) LIMIT 12",
    )
    .bind(&fts)
    .bind(paper_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for row in rows {
      let page: i64 = row.get("page");
      if !seen.insert(page) {
        continue;
      }
      let text: String = row.get("text");
      selected.push((page, text));
    }
  }

  if selected.is_empty() {
    return Ok(select_pages_for_budget(&mapped, ASK_RETRIEVED_CHAR_BUDGET));
  }

  // 补前 3 页，方便摘要/引言上下文
  for row in all_pages.iter().take(3) {
    if seen.insert(row.page) {
      selected.push((row.page, row.text.clone()));
    }
  }
  selected.sort_by_key(|(page, _)| *page);
  Ok(select_pages_for_budget(&selected, ASK_RETRIEVED_CHAR_BUDGET))
}

#[tauri::command]
pub async fn explain_get(state: State<'_, AppState>, paper_id: String) -> Result<PaperExplainSession> {
  let pool = state.pool.read().await;
  load_session(&pool, &paper_id).await
}

#[tauri::command]
pub async fn explain_start(
  state: State<'_, AppState>,
  paper_id: String,
  locale: Option<String>,
  reset_chat: Option<bool>,
) -> Result<PaperExplainSession> {
  let locale = locale.unwrap_or_else(|| "zh-CN".into());
  let _reset_chat = reset_chat.unwrap_or(true);
  let pool = state.pool.read().await;
  let (title, abstract_zh, abstract_en) = load_paper_meta(&pool, &paper_id).await?;
  let pages = load_pages(&pool, &paper_id).await?;
  if pages.is_empty() {
    return Err("尚无可用正文。请等待文本层抽取完成，或对扫描版先做 OCR。".into());
  }
  let mapped: Vec<(i64, String)> = pages.iter().map(|row| (row.page, row.text.clone())).collect();
  let selected = select_pages_for_budget(&mapped, OVERVIEW_CHAR_BUDGET);
  let body = format_pages(&selected);
  let prior = load_session(&pool, &paper_id).await?;
  let had_chats = !prior.chats.is_empty();
  drop(pool);

  let settings = load_llm_settings(&*state.pool.read().await).await?;
  let system = "你是学术论文精读助手。根据提供的 PDF 页文，用简体中文写结构化解读。只输出 JSON：{\"summary\":\"一句话总结\",\"problem\":\"研究问题与动机\",\"method\":\"方法与结构（可多段，段间用 \\n\\n）\",\"findings\":\"主要结果与贡献\",\"limits\":\"局限或适用边界\",\"readingTips\":\"精读建议\"}。summary≤60字；problem≤200字；method 合计 400～700 字；findings≤250字；limits≤150字；readingTips≤120字。依据页文，禁止编造未出现的实验数字与模块名。不要输出 markdown 代码块。";
  let user = format!(
    "标题：{title}\n中文摘要：{}\n英文摘要：{}\n\n页文：\n{body}",
    if abstract_zh.trim().is_empty() { "（无）" } else { abstract_zh.trim() },
    if abstract_en.trim().is_empty() { "（无）" } else { abstract_en.trim() },
  );
  let raw = llm_completion_opts(&settings, system, serde_json::Value::String(user), Some(3200), 180)
    .await
    .map_err(|error| format!("解读请求失败：{error}"))?;
  let overview = overview_from_value(&json_from_llm(&raw)?);
  if overview.summary.trim().is_empty() && overview.method.trim().is_empty() {
    return Err("LLM 未返回有效解读内容".into());
  }

  let pool = state.pool.read().await;
  let active_chat_id = if had_chats {
    prior.chat_id.clone()
  } else {
    Some(create_chat(&pool, &paper_id, "新对话").await?)
  };
  upsert_overview(
    &pool,
    &paper_id,
    &locale,
    Some(&overview),
    Some(&settings.model),
    active_chat_id.as_deref(),
  )
  .await?;
  load_session(&pool, &paper_id).await
}

#[tauri::command]
pub async fn explain_new_chat(state: State<'_, AppState>, paper_id: String) -> Result<PaperExplainSession> {
  let pool = state.pool.read().await;
  let session = load_session(&pool, &paper_id).await?;
  if session.overview.is_none() {
    return Err("请先生成解读，再新建对话".into());
  }
  let chat_id = create_chat(&pool, &paper_id, "新对话").await?;
  set_active_chat(&pool, &paper_id, Some(&chat_id)).await?;
  load_session(&pool, &paper_id).await
}

#[tauri::command]
pub async fn explain_switch_chat(
  state: State<'_, AppState>,
  paper_id: String,
  chat_id: String,
) -> Result<PaperExplainSession> {
  let pool = state.pool.read().await;
  let belongs: Option<String> = sqlx::query_scalar(
    "SELECT id FROM paper_explain_chats WHERE id=? AND paper_id=?",
  )
  .bind(&chat_id)
  .bind(&paper_id)
  .fetch_optional(&*pool)
  .await
  .map_err(err)?;
  if belongs.is_none() {
    return Err("对话不存在".into());
  }
  let session = load_session(&pool, &paper_id).await?;
  if session.overview.is_none() {
    return Err("请先生成解读".into());
  }
  set_active_chat(&pool, &paper_id, Some(&chat_id)).await?;
  load_session(&pool, &paper_id).await
}

#[tauri::command]
pub async fn explain_delete_chat(
  state: State<'_, AppState>,
  paper_id: String,
  chat_id: String,
) -> Result<PaperExplainSession> {
  let pool = state.pool.read().await;
  let deleted = sqlx::query("DELETE FROM paper_explain_chats WHERE id=? AND paper_id=?")
    .bind(&chat_id)
    .bind(&paper_id)
    .execute(&*pool)
    .await
    .map_err(err)?
    .rows_affected();
  if deleted == 0 {
    return Err("对话不存在".into());
  }
  load_session(&pool, &paper_id).await
}

#[tauri::command]
pub async fn explain_ask(
  state: State<'_, AppState>,
  paper_id: String,
  question: String,
) -> Result<PaperExplainSession> {
  let question = question.trim().to_string();
  if question.is_empty() {
    return Err("请输入问题".into());
  }
  if question.chars().count() > 4_000 {
    return Err("问题过长".into());
  }

  let pool = state.pool.read().await;
  let (title, abstract_zh, abstract_en) = load_paper_meta(&pool, &paper_id).await?;
  let mut session = load_session(&pool, &paper_id).await?;
  if session.overview.is_none() {
    return Err("请先生成解读，再提问".into());
  }
  let chat_id = match session.chat_id.clone() {
    Some(id) => id,
    None => {
      let id = create_chat(&pool, &paper_id, "新对话").await?;
      set_active_chat(&pool, &paper_id, Some(&id)).await?;
      id
    }
  };
  let pages = load_pages(&pool, &paper_id).await?;
  if pages.is_empty() {
    return Err("尚无可用正文，无法回答".into());
  }
  let retrieved = retrieve_pages_for_question(&pool, &paper_id, &question, &pages).await?;
  let body = format_pages(&retrieved);
  let overview = session.overview.clone().unwrap();
  let history: Vec<PaperExplainMessage> = session
    .messages
    .iter()
    .rev()
    .take(ASK_HISTORY_TURNS)
    .cloned()
    .collect::<Vec<_>>()
    .into_iter()
    .rev()
    .collect();
  let rename_title = session.messages.is_empty();
  drop(pool);

  let settings = load_llm_settings(&*state.pool.read().await).await?;
  let system = "你是这篇 PDF 的精读答疑助手。只根据系统提供的页文与已有解读作答，使用简体中文。若页文不足，明确说明未知。回答中引用具体页码，格式如 P3 或「第 3 页」。不要编造未给出的数据。";
  let mut transcript = String::new();
  for message in &history {
    let label = if message.role == "user" { "用户" } else { "助手" };
    transcript.push_str(&format!("{label}：{}\n", message.content.trim()));
  }
  let user = format!(
    "标题：{title}\n摘要：{}\n{}\n\n已有解读摘要：{}\n\n相关页文：\n{body}\n\n对话：\n{transcript}\n用户：{question}\n助手：",
    if abstract_zh.trim().is_empty() { abstract_en.trim() } else { abstract_zh.trim() },
    if abstract_zh.trim().is_empty() || abstract_en.trim().is_empty() {
      String::new()
    } else {
      format!("英文摘要：{}", abstract_en.trim())
    },
    overview.summary,
  );
  let answer = llm_completion_opts(&settings, system, serde_json::Value::String(user), Some(1800), 150)
    .await
    .map_err(|error| format!("提问失败：{error}"))?;
  let answer = answer.trim().to_string();
  if answer.is_empty() {
    return Err("LLM 返回了空回答".into());
  }
  let now = Utc::now().to_rfc3339();
  session.messages.push(PaperExplainMessage {
    role: "user".into(),
    content: question.clone(),
    cites: None,
    created_at: now.clone(),
  });
  session.messages.push(PaperExplainMessage {
    role: "assistant".into(),
    content: answer.clone(),
    cites: {
      let cites = extract_cites(&answer);
      if cites.is_empty() { None } else { Some(cites) }
    },
    created_at: now,
  });

  let pool = state.pool.read().await;
  let title_update = if rename_title {
    Some(title_from_question(&question))
  } else {
    None
  };
  save_chat_messages(
    &pool,
    &chat_id,
    &session.messages,
    Some(&settings.model),
    title_update.as_deref(),
  )
  .await?;
  sqlx::query("UPDATE paper_explains SET updated_at=? WHERE paper_id=?")
    .bind(Utc::now().to_rfc3339())
    .bind(&paper_id)
    .execute(&*pool)
    .await
    .map_err(err)?;
  load_session(&pool, &paper_id).await
}

/// 删除一轮问答。`message_index` 可为该轮 user 或 assistant 的下标；成对时一并删除。
pub fn remove_explain_turn(messages: &mut Vec<PaperExplainMessage>, message_index: usize) -> Result<()> {
  if message_index >= messages.len() {
    return Err("消息不存在".into());
  }
  let start = if messages[message_index].role == "assistant"
    && message_index > 0
    && messages[message_index - 1].role == "user"
  {
    message_index - 1
  } else {
    message_index
  };
  let end = if start + 1 < messages.len()
    && messages[start].role == "user"
    && messages[start + 1].role == "assistant"
  {
    start + 2
  } else {
    start + 1
  };
  messages.drain(start..end);
  Ok(())
}

#[tauri::command]
pub async fn explain_delete_turn(
  state: State<'_, AppState>,
  paper_id: String,
  message_index: usize,
) -> Result<PaperExplainSession> {
  let pool = state.pool.read().await;
  let mut session = load_session(&pool, &paper_id).await?;
  let chat_id = session.chat_id.clone().ok_or_else(|| "当前没有对话".to_string())?;
  remove_explain_turn(&mut session.messages, message_index)?;
  save_chat_messages(&pool, &chat_id, &session.messages, session.model.as_deref(), None).await?;
  load_session(&pool, &paper_id).await
}

#[tauri::command]
pub async fn explain_reset(state: State<'_, AppState>, paper_id: String) -> Result<PaperExplainSession> {
  let pool = state.pool.read().await;
  sqlx::query("DELETE FROM paper_explain_chats WHERE paper_id=?")
    .bind(&paper_id)
    .execute(&*pool)
    .await
    .map_err(err)?;
  sqlx::query("DELETE FROM paper_explains WHERE paper_id=?")
    .bind(&paper_id)
    .execute(&*pool)
    .await
    .map_err(err)?;
  Ok(empty_session(&paper_id))
}

#[cfg(test)]
mod tests {
  use super::{extract_cites, remove_explain_turn, select_pages_for_budget, PaperExplainMessage};

  #[test]
  fn budget_keeps_all_when_small() {
    let pages = vec![(1, "a".repeat(10)), (2, "b".repeat(10))];
    let selected = select_pages_for_budget(&pages, 10_000);
    assert_eq!(selected.len(), 2);
  }

  #[test]
  fn budget_prefers_early_pages() {
    let pages: Vec<(i64, String)> = (1..=20).map(|page| (page, format!("page {page} {}", "x".repeat(200)))).collect();
    let selected = select_pages_for_budget(&pages, 900);
    assert!(!selected.is_empty());
    assert!(selected.iter().any(|(page, _)| *page <= 3));
    let total: usize = selected.iter().map(|(_, text)| text.chars().count()).sum();
    assert!(total <= 900 + 200);
  }

  #[test]
  fn cites_from_p_and_chinese() {
    let cites = extract_cites("见 P3 与第 7 页，以及 p.12。");
    assert!(cites.contains(&3));
    assert!(cites.contains(&7));
    assert!(cites.contains(&12));
  }

  #[test]
  fn delete_turn_removes_user_assistant_pair() {
    let mut messages = vec![
      PaperExplainMessage { role: "user".into(), content: "q1".into(), cites: None, created_at: "t1".into() },
      PaperExplainMessage { role: "assistant".into(), content: "a1".into(), cites: None, created_at: "t2".into() },
      PaperExplainMessage { role: "user".into(), content: "q2".into(), cites: None, created_at: "t3".into() },
      PaperExplainMessage { role: "assistant".into(), content: "a2".into(), cites: None, created_at: "t4".into() },
    ];
    remove_explain_turn(&mut messages, 1).unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].content, "q2");
    assert_eq!(messages[1].content, "a2");
    remove_explain_turn(&mut messages, 0).unwrap();
    assert!(messages.is_empty());
  }
}
