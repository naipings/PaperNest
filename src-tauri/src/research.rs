use super::*;
use std::io::Write;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS research_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  query TEXT NOT NULL,
  output_requirements TEXT NOT NULL DEFAULT '',
  workspace_path TEXT NOT NULL,
  report_path TEXT NOT NULL,
  status TEXT NOT NULL,
  report_preview TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_sessions_updated ON research_sessions(updated_at DESC);
"#;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchLlmSettings {
  pub enabled: bool,
  pub base_url: String,
  pub model: String,
  #[serde(default)]
  pub api_key_saved: bool,
  #[serde(default)]
  pub allow_web_search: bool,
  #[serde(default = "default_max_iterations")]
  pub max_iterations: i64,
  #[serde(default = "default_max_tokens")]
  pub max_tokens_per_step: u32,
  #[serde(default = "default_research_mode")]
  pub research_mode: String,
  #[serde(default = "default_research_depth")]
  pub research_depth: String,
  #[serde(default)]
  pub max_react_rounds: u32,
  #[serde(default)]
  pub max_tool_calls: u32,
}

fn default_research_mode() -> String {
  "react".into()
}

fn default_research_depth() -> String {
  "standard".into()
}

fn default_max_iterations() -> i64 {
  8
}

fn default_max_tokens() -> u32 {
  4000
}

fn default_research_settings() -> ResearchLlmSettings {
  ResearchLlmSettings {
    enabled: false,
    base_url: "https://api.openai.com/v1".into(),
    model: "gpt-4.1".into(),
    api_key_saved: false,
    allow_web_search: false,
    max_iterations: 8,
    max_tokens_per_step: 4000,
    research_mode: "react".into(),
    research_depth: "standard".into(),
    max_react_rounds: 0,
    max_tool_calls: 0,
  }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSession {
  pub id: String,
  pub title: String,
  pub query: String,
  pub output_requirements: String,
  pub workspace_path: String,
  pub report_path: String,
  pub status: String,
  pub report_preview: Option<String>,
  pub error: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSource {
  pub id: String,
  pub kind: String,
  pub url: Option<String>,
  pub title: String,
  pub accessed_at: String,
  pub excerpt: String,
  pub local_paper_id: Option<String>,
  pub page: Option<i64>,
  pub stored_locally: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchStepSummary {
  pub file_name: String,
  pub kind: String,
  pub created_at: String,
  pub label: Option<String>,
  pub detail: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CreateSessionInput {
  query: String,
  output_requirements: Option<String>,
  workspace_path: Option<String>,
  title: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct SessionManifest {
  id: String,
  title: String,
  query: String,
  output_requirements: String,
  workspace_path: String,
  created_at: String,
}

fn research_key_entry() -> Result<keyring::Entry> {
  keyring::Entry::new("PaperNest", "research_api_key").map_err(err)
}

async fn open_research_pool(library_dir: &Path) -> Result<SqlitePool> {
  let db_path = library_dir.join("research.db");
  let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.to_string_lossy()))
    .map_err(err)?
    .create_if_missing(true);
  let pool = SqlitePoolOptions::new()
    .max_connections(3)
    .connect_with(options)
    .await
    .map_err(err)?;
  for statement in SCHEMA.split(';').map(str::trim).filter(|s| !s.is_empty()) {
    sqlx::query(statement).execute(&pool).await.map_err(err)?;
  }
  Ok(pool)
}

async fn load_settings(pool: &SqlitePool) -> Result<ResearchLlmSettings> {
  let raw: Option<String> = sqlx::query_scalar("SELECT value FROM research_meta WHERE key='settings'")
    .fetch_optional(pool)
    .await
    .map_err(err)?;
  let mut settings = raw
    .as_deref()
    .and_then(|value| serde_json::from_str(value).ok())
    .unwrap_or_else(default_research_settings);
  settings.api_key_saved = research_key_entry()
    .and_then(|entry| entry.get_password().map_err(err))
    .is_ok();
  Ok(settings)
}

async fn save_settings(pool: &SqlitePool, mut settings: ResearchLlmSettings) -> Result<ResearchLlmSettings> {
  settings.api_key_saved = research_key_entry()
    .and_then(|entry| entry.get_password().map_err(err))
    .is_ok();
  let payload = serde_json::to_string(&settings).map_err(err)?;
  sqlx::query("INSERT INTO research_meta(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(payload)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(settings)
}

pub(crate) fn validate_research_settings(settings: &ResearchLlmSettings) -> Result<()> {
  if settings.base_url.trim().is_empty() {
    return Err("请填写 API 基础地址".into());
  }
  if settings.model.trim().is_empty() {
    return Err("请填写模型名称".into());
  }
  Ok(())
}

fn row_session(r: sqlx::sqlite::SqliteRow) -> ResearchSession {
  ResearchSession {
    id: r.get("id"),
    title: r.get("title"),
    query: r.get("query"),
    output_requirements: r.get("output_requirements"),
    workspace_path: r.get("workspace_path"),
    report_path: r.get("report_path"),
    status: r.get("status"),
    report_preview: r.get("report_preview"),
    error: r.get("error"),
    created_at: r.get("created_at"),
    updated_at: r.get("updated_at"),
  }
}

fn init_workspace(workspace: &Path, manifest: &SessionManifest) -> Result<()> {
  fs::create_dir_all(workspace.join("steps")).map_err(err)?;
  fs::create_dir_all(workspace.join("proposals")).map_err(err)?;
  fs::write(
    workspace.join("manifest.json"),
    serde_json::to_vec_pretty(manifest).map_err(err)?,
  )
  .map_err(err)?;
  if !workspace.join("report.md").exists() {
    fs::write(workspace.join("report.md"), "# 调研报告\n\n").map_err(err)?;
  }
  if !workspace.join("sources.jsonl").exists() {
    fs::write(workspace.join("sources.jsonl"), "").map_err(err)?;
  }
  if !workspace.join("outline.md").exists() {
    fs::write(workspace.join("outline.md"), "").map_err(err)?;
  }
  Ok(())
}

pub(crate) fn read_sources(workspace: &Path) -> Result<Vec<ResearchSource>> {
  let path = workspace.join("sources.jsonl");
  if !path.exists() {
    return Ok(vec![]);
  }
  let text = fs::read_to_string(path).map_err(err)?;
  let mut out = Vec::new();
  for line in text.lines().map(str::trim).filter(|line| !line.is_empty()) {
    if let Ok(source) = serde_json::from_str::<ResearchSource>(line) {
      out.push(source);
    }
  }
  Ok(out)
}

pub(crate) fn append_source(workspace: &Path, source: &ResearchSource) -> Result<()> {
  let path = workspace.join("sources.jsonl");
  let mut file = fs::OpenOptions::new().create(true).append(true).open(path).map_err(err)?;
  let line = serde_json::to_string(source).map_err(err)?;
  writeln!(file, "{line}").map_err(err)?;
  Ok(())
}

pub(crate) fn write_step(workspace: &Path, index: usize, kind: &str, payload: &serde_json::Value) -> Result<()> {
  let name = format!("{:03}-{}.json", index, kind);
  let mut body = payload.clone();
  if let Some(obj) = body.as_object_mut() {
    obj.insert("kind".into(), serde_json::json!(kind));
    obj.insert("created_at".into(), serde_json::json!(Utc::now().to_rfc3339()));
  }
  fs::write(workspace.join("steps").join(name), serde_json::to_vec_pretty(&body).map_err(err)?).map_err(err)?;
  Ok(())
}

fn report_preview(text: &str) -> String {
  text.chars().take(500).collect()
}

async fn upsert_session(pool: &SqlitePool, session: &ResearchSession) -> Result<()> {
  sqlx::query(
    "INSERT INTO research_sessions(id,title,query,output_requirements,workspace_path,report_path,status,report_preview,error,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title,query=excluded.query,output_requirements=excluded.output_requirements,
       workspace_path=excluded.workspace_path,report_path=excluded.report_path,status=excluded.status,
       report_preview=excluded.report_preview,error=excluded.error,updated_at=excluded.updated_at",
  )
  .bind(&session.id)
  .bind(&session.title)
  .bind(&session.query)
  .bind(&session.output_requirements)
  .bind(&session.workspace_path)
  .bind(&session.report_path)
  .bind(&session.status)
  .bind(&session.report_preview)
  .bind(&session.error)
  .bind(&session.created_at)
  .bind(&session.updated_at)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

async fn get_session_row(pool: &SqlitePool, id: &str) -> Result<ResearchSession> {
  sqlx::query("SELECT * FROM research_sessions WHERE id=?")
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(err)?
    .map(row_session)
    .ok_or_else(|| "调研会话不存在".to_string())
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchProposal {
  pub id: String,
  pub kind: String,
  pub status: String,
  pub title: String,
  pub arxiv_id: Option<String>,
  pub abstract_en: Option<String>,
  pub url: Option<String>,
  pub source_id: String,
  pub created_at: String,
  pub resolved_paper_id: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchImportResult {
  pub paper_id: String,
  pub title: String,
  pub downloaded_pdf: bool,
}

pub async fn open_research_pool_public(library_dir: &Path) -> Result<SqlitePool> {
  open_research_pool(library_dir).await
}

pub async fn list_sessions_public(pool: &SqlitePool) -> Result<Vec<ResearchSession>> {
  let rows = sqlx::query("SELECT * FROM research_sessions ORDER BY updated_at DESC")
    .fetch_all(pool)
    .await
    .map_err(err)?;
  Ok(rows.into_iter().map(row_session).collect())
}

pub async fn get_session_public(pool: &SqlitePool, id: &str) -> Result<ResearchSession> {
  get_session_row(pool, id).await
}

fn arxiv_id_from_url(url: &str) -> Option<String> {
  let marker = "/abs/";
  let idx = url.find(marker)?;
  let rest = url[idx + marker.len()..].trim();
  let id = rest.split(['/', '?', '#']).next()?.trim();
  if id.is_empty() {
    None
  } else {
    Some(radar::clean_arxiv_id(id))
  }
}

fn read_proposals(workspace: &Path) -> Result<Vec<ResearchProposal>> {
  let dir = workspace.join("proposals");
  if !dir.is_dir() {
    return Ok(vec![]);
  }
  let mut out = Vec::new();
  for entry in fs::read_dir(dir).map_err(err)? {
    let entry = entry.map_err(err)?;
    if entry.path().extension().and_then(|v| v.to_str()) != Some("json") {
      continue;
    }
    let text = fs::read_to_string(entry.path()).map_err(err)?;
    if let Ok(item) = serde_json::from_str::<ResearchProposal>(&text) {
      out.push(item);
    }
  }
  out.sort_by(|a, b| a.created_at.cmp(&b.created_at));
  Ok(out)
}

fn write_proposal(workspace: &Path, proposal: &ResearchProposal) -> Result<()> {
  let path = workspace.join("proposals").join(format!("{}.json", proposal.id));
  fs::write(path, serde_json::to_vec_pretty(proposal).map_err(err)?).map_err(err)
}

async fn library_has_arxiv(pool: &SqlitePool, arxiv_id: &str) -> Result<bool> {
  let rows = sqlx::query("SELECT arxiv_id FROM papers WHERE deleted_at IS NULL AND arxiv_id IS NOT NULL")
    .fetch_all(pool)
    .await
    .map_err(err)?;
  Ok(rows.iter().any(|row| {
    row
      .get::<Option<String>, _>("arxiv_id")
      .as_deref()
      .map(radar::clean_arxiv_id)
      .as_deref()
      == Some(arxiv_id)
  }))
}

async fn write_import_proposals(
  workspace: &Path,
  sources: &[ResearchSource],
  library_pool: &SqlitePool,
) -> Result<()> {
  for source in sources.iter().filter(|s| s.kind == "arxiv") {
    let arxiv_id = source
      .url
      .as_deref()
      .and_then(arxiv_id_from_url)
      .filter(|id| !id.is_empty());
    let Some(arxiv_id) = arxiv_id else { continue };
    if library_has_arxiv(library_pool, &arxiv_id).await? {
      continue;
    }
    let proposal = ResearchProposal {
      id: format!("import-{}", arxiv_id.replace('.', "-")),
      kind: "import_arxiv".into(),
      status: "pending".into(),
      title: source.title.clone(),
      arxiv_id: Some(arxiv_id),
      abstract_en: Some(source.excerpt.clone()).filter(|v| !v.trim().is_empty()),
      url: source.url.clone(),
      source_id: source.id.clone(),
      created_at: Utc::now().to_rfc3339(),
      resolved_paper_id: None,
    };
    write_proposal(workspace, &proposal)?;
  }
  Ok(())
}

pub(crate) fn sources_block(collected: &[ResearchSource]) -> String {
  collected
    .iter()
    .map(|s| {
      format!(
        "[{}] {} | {} | {}",
        s.id,
        s.title,
        s.url.clone().unwrap_or_else(|| "本地论文库".into()),
        s.excerpt.chars().take(280).collect::<String>()
      )
    })
    .collect::<Vec<_>>()
    .join("\n")
}

async fn run_research_agent(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
) -> Result<String> {
  if settings.research_mode == "pipeline" {
    return run_pipeline_agent(library_pool, settings, session).await;
  }
  let finish = crate::research_react::run_react_loop(library_pool, settings, session).await?;
  let mut finish = finish;
  crate::research_reviewer::apply_reviewer_gate(library_pool, settings, session, &mut finish).await?;
  let report = crate::research_writer::write_research_report(settings, session, &finish).await?;
  write_import_proposals(
    Path::new(&session.workspace_path),
    &finish.sources,
    library_pool,
  )
  .await?;
  Ok(report)
}

async fn run_pipeline_agent(
  library_pool: &SqlitePool,
  settings: &ResearchLlmSettings,
  session: &ResearchSession,
) -> Result<String> {
  let workspace = PathBuf::from(&session.workspace_path);
  let now = Utc::now().to_rfc3339();
  let mut step_index = 1usize;
  let mut collector = crate::research_tools::SourceCollector::from_workspace(&workspace)?;

  let plan_system = "你是文献调研规划助手（Planner）。根据研究问题输出 JSON：{\"queries\":[\"检索词1\"],\"outline\":\"Markdown 大纲\"}。queries 2～4 个；outline 为章节骨架。只输出 JSON。";
  let plan_user = format!(
    "研究问题：{}\n输出要求：{}\n",
    session.query,
    if session.output_requirements.trim().is_empty() {
      "中文综述，含引用标注".to_string()
    } else {
      session.output_requirements.clone()
    }
  );
  let plan_raw = crate::research_llm::research_llm_completion(settings, plan_system, serde_json::json!(plan_user), Some(1200), 120).await?;
  let plan_json = json_from_llm(&plan_raw)?;
  let queries: Vec<String> = plan_json
    .get("queries")
    .and_then(|v| v.as_array())
    .map(|items| {
      items
        .iter()
        .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
        .collect()
    })
    .filter(|items: &Vec<String>| !items.is_empty())
    .unwrap_or_else(|| vec![session.query.clone()]);
  let outline = plan_json
    .get("outline")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .trim()
    .to_string();
  fs::write(workspace.join("outline.md"), &outline).map_err(err)?;
  write_step(
    &workspace,
    step_index,
    "planner-plan",
    &serde_json::json!({ "role": "planner", "queries": queries, "outline": outline }),
  )?;
  step_index += 1;

  for query in queries.iter().take(settings.max_iterations.max(2) as usize) {
    let outcome = crate::research_tools::pipeline_invoke(
      library_pool,
      &workspace,
      settings.allow_web_search,
      &mut collector,
      &now,
      "search_library",
      serde_json::json!({ "query": query }),
    )
    .await?;
    write_step(
      &workspace,
      step_index,
      "researcher-search_library",
      &serde_json::json!({ "role": "researcher", "query": query, "observation": tool_observation(&outcome) }),
    )?;
    step_index += 1;
  }

  if settings.allow_web_search {
    for query in queries.iter().take(2) {
      let outcome = crate::research_tools::pipeline_invoke(
        library_pool,
        &workspace,
        true,
        &mut collector,
        &now,
        "search_arxiv",
        serde_json::json!({ "query": query }),
      )
      .await?;
      write_step(
        &workspace,
        step_index,
        "researcher-search_arxiv",
        &serde_json::json!({ "role": "researcher", "query": query, "observation": tool_observation(&outcome) }),
      )?;
      step_index += 1;
      tokio::time::sleep(Duration::from_millis(1100)).await;
    }
  }

  let collected = collector.sources().to_vec();
  let reflect_system = "你是文献调研反思助手（Reflect）。根据问题、大纲与来源，输出 JSON：{\"gaps\":[\"证据缺口\"],\"follow_up_queries\":[\"补充检索\"],\"notes\":\"给写作者的备忘\"}。follow_up_queries 最多 2 个；无缺口则空数组。只输出 JSON。";
  let reflect_user = format!(
    "研究问题：{}\n大纲：\n{}\n\n来源：\n{}\n",
    session.query,
    outline,
    sources_block(&collected)
  );
  let reflect_raw = crate::research_llm::research_llm_completion(
    settings,
    reflect_system,
    serde_json::json!(reflect_user),
    Some(900),
    90,
  )
  .await?;
  let reflect_json = json_from_llm(&reflect_raw).unwrap_or_else(|_| serde_json::json!({}));
  let follow_ups: Vec<String> = reflect_json
    .get("follow_up_queries")
    .and_then(|v| v.as_array())
    .map(|items| {
      items
        .iter()
        .filter_map(|v| v.as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string))
        .take(2)
        .collect()
    })
    .unwrap_or_default();
  let reflect_notes = reflect_json
    .get("notes")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .trim()
    .to_string();
  write_step(
    &workspace,
    step_index,
    "reflect",
    &serde_json::json!({ "role": "reflect", "raw": reflect_raw, "follow_up_queries": follow_ups, "notes": reflect_notes }),
  )?;
  step_index += 1;

  for query in follow_ups {
    let outcome = crate::research_tools::pipeline_invoke(
      library_pool,
      &workspace,
      settings.allow_web_search,
      &mut collector,
      &now,
      "search_library",
      serde_json::json!({ "query": query }),
    )
    .await?;
    write_step(
      &workspace,
      step_index,
      "researcher-followup",
      &serde_json::json!({ "role": "researcher", "query": query, "observation": tool_observation(&outcome) }),
    )?;
    step_index += 1;
    if settings.allow_web_search {
      let arxiv = crate::research_tools::pipeline_invoke(
        library_pool,
        &workspace,
        true,
        &mut collector,
        &now,
        "search_arxiv",
        serde_json::json!({ "query": query }),
      )
      .await?;
      write_step(
        &workspace,
        step_index,
        "researcher-followup-arxiv",
        &serde_json::json!({ "role": "researcher", "query": query, "observation": tool_observation(&arxiv) }),
      )?;
      step_index += 1;
      tokio::time::sleep(Duration::from_millis(1100)).await;
    }
  }

  let collected = collector.into_sources();
  let finish = crate::research_react::ReactFinish {
    summary: reflect_notes.clone(),
    sources: collected.clone(),
  };
  let report = crate::research_writer::write_research_report(settings, session, &finish).await?;
  write_import_proposals(&workspace, &collected, library_pool).await?;
  Ok(report)
}

fn tool_observation(outcome: &crate::research_tools::ToolOutcome) -> String {
  match outcome {
    crate::research_tools::ToolOutcome::Continue { observation, .. } => observation.clone(),
    crate::research_tools::ToolOutcome::Finished { summary } => summary.clone(),
    crate::research_tools::ToolOutcome::Subtopics { questions } => format!("子问题：{questions:?}"),
  }
}

#[tauri::command]
pub async fn research_get_settings(state: State<'_, AppState>) -> Result<ResearchLlmSettings> {
  let pool = open_research_pool(&state.library_dir).await?;
  let settings = load_settings(&pool).await?;
  pool.close().await;
  Ok(settings)
}

#[tauri::command]
pub async fn research_save_settings(
  state: State<'_, AppState>,
  mut settings: ResearchLlmSettings,
  api_key: Option<String>,
) -> Result<ResearchLlmSettings> {
  validate_research_settings(&settings)?;
  if let Some(key) = api_key.filter(|value| !value.trim().is_empty()) {
    research_key_entry()?.set_password(&key).map_err(err)?;
    settings.api_key_saved = true;
  }
  let pool = open_research_pool(&state.library_dir).await?;
  let saved = save_settings(&pool, settings).await?;
  pool.close().await;
  Ok(saved)
}

#[tauri::command]
pub async fn research_test_connection(state: State<'_, AppState>) -> Result<()> {
  let pool = open_research_pool(&state.library_dir).await?;
  let settings = load_settings(&pool).await?;
  pool.close().await;
  let answer = crate::research_llm::research_llm_completion(&settings, "Return exactly OK.", serde_json::json!("OK"), Some(16), 60).await?;
  if answer.trim().is_empty() {
    return Err("调研 LLM 返回了空响应".into());
  }
  Ok(())
}

#[tauri::command]
pub async fn research_list_sessions(state: State<'_, AppState>) -> Result<Vec<ResearchSession>> {
  let pool = open_research_pool(&state.library_dir).await?;
  let rows = sqlx::query("SELECT * FROM research_sessions ORDER BY updated_at DESC")
    .fetch_all(&pool)
    .await
    .map_err(err)?;
  pool.close().await;
  Ok(rows.into_iter().map(row_session).collect())
}

#[tauri::command]
pub async fn research_create_session(
  state: State<'_, AppState>,
  input: CreateSessionInput,
) -> Result<ResearchSession> {
  let settings_pool = open_research_pool(&state.library_dir).await?;
  let settings = load_settings(&settings_pool).await?;
  settings_pool.close().await;
  if !settings.enabled {
    return Err("请先在设置中启用文献调研".into());
  }
  let query = input.query.trim().to_string();
  if query.is_empty() {
    return Err("请填写研究问题".into());
  }
  let id = Uuid::new_v4().to_string();
  let title = input
    .title
    .filter(|v| !v.trim().is_empty())
    .unwrap_or_else(|| query.chars().take(40).collect());
  let output_requirements = input.output_requirements.unwrap_or_default();
  let workspace = match input.workspace_path.filter(|p| !p.trim().is_empty()) {
    Some(path) => PathBuf::from(path),
    None => state.library_dir.join("research").join(&id),
  };
  fs::create_dir_all(&workspace).map_err(err)?;
  let report_path = workspace.join("report.md").to_string_lossy().into_owned();
  let now = Utc::now().to_rfc3339();
  let manifest = SessionManifest {
    id: id.clone(),
    title: title.clone(),
    query: query.clone(),
    output_requirements: output_requirements.clone(),
    workspace_path: workspace.to_string_lossy().into_owned(),
    created_at: now.clone(),
  };
  init_workspace(&workspace, &manifest)?;
  let session = ResearchSession {
    id,
    title,
    query,
    output_requirements,
    workspace_path: workspace.to_string_lossy().into_owned(),
    report_path,
    status: "draft".into(),
    report_preview: None,
    error: None,
    created_at: now.clone(),
    updated_at: now,
  };
  let pool = open_research_pool(&state.library_dir).await?;
  upsert_session(&pool, &session).await?;
  pool.close().await;
  Ok(session)
}

#[tauri::command]
pub async fn research_get_session(state: State<'_, AppState>, id: String) -> Result<ResearchSession> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &id).await?;
  pool.close().await;
  Ok(session)
}

#[tauri::command]
pub async fn research_read_report(state: State<'_, AppState>, id: String) -> Result<String> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &id).await?;
  pool.close().await;
  fs::read_to_string(&session.report_path).map_err(err)
}

#[tauri::command]
pub async fn research_read_sources(state: State<'_, AppState>, id: String) -> Result<Vec<ResearchSource>> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &id).await?;
  pool.close().await;
  read_sources(Path::new(&session.workspace_path))
}

#[tauri::command]
pub async fn research_list_steps(state: State<'_, AppState>, id: String) -> Result<Vec<ResearchStepSummary>> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &id).await?;
  pool.close().await;
  let steps_dir = Path::new(&session.workspace_path).join("steps");
  let mut items = Vec::new();
  if steps_dir.is_dir() {
    for entry in fs::read_dir(steps_dir).map_err(err)? {
      let entry = entry.map_err(err)?;
      let path = entry.path();
      let name = entry.file_name().to_string_lossy().into_owned();
      let kind = step_kind_from_name(&name);
      let created_at = entry
        .metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .map(|t| chrono::DateTime::<Utc>::from(t).to_rfc3339())
        .unwrap_or_else(|| Utc::now().to_rfc3339());
      let (label, detail) = step_label_from_file(&path);
      items.push(ResearchStepSummary {
        file_name: name,
        kind,
        created_at,
        label,
        detail,
      });
    }
    items.sort_by(|a, b| a.file_name.cmp(&b.file_name));
  }
  Ok(items)
}

fn step_kind_from_name(name: &str) -> String {
  name
    .trim_end_matches(".json")
    .split('-')
    .skip(1)
    .collect::<Vec<_>>()
    .join("-")
}

fn step_label_from_file(path: &Path) -> (Option<String>, Option<String>) {
  let text = match fs::read_to_string(path) {
    Ok(t) => t,
    Err(_) => return (None, None),
  };
  let json: serde_json::Value = match serde_json::from_str(&text) {
    Ok(v) => v,
    Err(_) => return (None, None),
  };
  let kind = json.get("kind").and_then(|v| v.as_str()).unwrap_or("");
  let label = if kind.starts_with("react-tool-") {
    let tool = kind.strip_prefix("react-tool-").unwrap_or(kind);
    let round = json.get("round").and_then(|v| v.as_u64());
    round.map(|r| format!("第{r}轮 · {tool}"))
      .or_else(|| Some(tool.to_string()))
  } else if kind == "react-llm" {
    json.get("round").and_then(|v| v.as_u64()).map(|r| format!("第{r}轮 · LLM 思考"))
  } else if kind == "react-finish" {
    Some("完成调研循环".into())
  } else if kind == "reviewer" {
    Some("审稿".into())
  } else if kind.starts_with("subagent-") {
    Some(kind.replace('-', " · "))
  } else if kind == "writer-report" {
    Some("撰写报告".into())
  } else {
    Some(kind.to_string())
  };
  let detail = json
    .get("observation")
    .or_else(|| json.get("summary"))
    .or_else(|| json.get("tool").and_then(|_| json.get("args")))
    .and_then(|v| {
      if let Some(s) = v.as_str() {
        Some(s.chars().take(120).collect())
      } else {
        Some(v.to_string().chars().take(120).collect())
      }
    });
  (label, detail)
}

#[tauri::command]
pub async fn research_run_session(state: State<'_, AppState>, id: String) -> Result<ResearchSession> {
  let research_pool = open_research_pool(&state.library_dir).await?;
  let settings = load_settings(&research_pool).await?;
  if !settings.enabled {
    research_pool.close().await;
    return Err("请先在设置中启用文献调研".into());
  }
  let mut session = get_session_row(&research_pool, &id).await?;
  if session.status == "running" {
    research_pool.close().await;
    return Err("该调研正在运行".into());
  }
  session.status = "running".into();
  session.error = None;
  session.updated_at = Utc::now().to_rfc3339();
  upsert_session(&research_pool, &session).await?;
  research_pool.close().await;

  let library_pool = state.pool.read().await.clone();
  let run = run_research_agent(&library_pool, &settings, &session).await;
  let research_pool = open_research_pool(&state.library_dir).await?;
  let mut session = get_session_row(&research_pool, &id).await?;
  match run {
    Ok(report) => {
      session.status = "completed".into();
      session.report_preview = Some(report_preview(&report));
      session.error = None;
    }
    Err(error) => {
      session.status = "failed".into();
      session.error = Some(error);
    }
  }
  session.updated_at = Utc::now().to_rfc3339();
  upsert_session(&research_pool, &session).await?;
  research_pool.close().await;
  Ok(session)
}

#[tauri::command]
pub async fn research_open_workspace(state: State<'_, AppState>, id: String) -> Result<()> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &id).await?;
  pool.close().await;
  open::that(&session.workspace_path).map_err(err)
}

#[tauri::command]
pub async fn research_delete_session(state: State<'_, AppState>, id: String) -> Result<()> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &id).await?;
  sqlx::query("DELETE FROM research_sessions WHERE id=?")
    .bind(&id)
    .execute(&pool)
    .await
    .map_err(err)?;
  pool.close().await;
  let workspace = PathBuf::from(session.workspace_path);
  let default_root = state.library_dir.join("research");
  if workspace.starts_with(&default_root) {
    let _ = fs::remove_dir_all(workspace);
  }
  Ok(())
}

#[tauri::command]
pub async fn research_list_proposals(state: State<'_, AppState>, session_id: String) -> Result<Vec<ResearchProposal>> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &session_id).await?;
  pool.close().await;
  read_proposals(Path::new(&session.workspace_path))
}

async fn approve_import_proposal(
  state: &AppState,
  workspace: &Path,
  proposal: &mut ResearchProposal,
  download_pdf: bool,
) -> Result<ResearchImportResult> {
  if proposal.status != "pending" {
    return Err("该提案已处理".into());
  }
  let arxiv_id = proposal.arxiv_id.clone().ok_or_else(|| "缺少 arXiv ID".to_string())?;
  let pool = state.pool.read().await;
  if library_has_arxiv(&pool, &arxiv_id).await? {
    return Err("资料库已有该 arXiv 论文".into());
  }
  let mut paper = blank_paper(proposal.title.clone());
  paper.arxiv_id = Some(arxiv_id.clone());
  paper.abstract_en = proposal.abstract_en.clone();
  paper.source_url = proposal
    .url
    .clone()
    .or_else(|| Some(format!("https://arxiv.org/abs/{arxiv_id}")));
  let downloaded_pdf = if download_pdf {
    let rel = radar::download_arxiv_pdf(&state.library_dir, &arxiv_id).await?;
    paper.pdf_path = Some(rel);
    true
  } else {
    false
  };
  put_paper(&pool, &paper).await?;
  proposal.status = "approved".into();
  proposal.resolved_paper_id = Some(paper.id.clone());
  write_proposal(workspace, proposal)?;
  Ok(ResearchImportResult {
    paper_id: paper.id,
    title: paper.title_en,
    downloaded_pdf,
  })
}

#[tauri::command]
pub async fn research_approve_proposal(
  state: State<'_, AppState>,
  session_id: String,
  proposal_id: String,
  download_pdf: bool,
) -> Result<ResearchImportResult> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &session_id).await?;
  pool.close().await;
  let workspace = Path::new(&session.workspace_path);
  let mut proposals = read_proposals(workspace)?;
  let proposal = proposals
    .iter_mut()
    .find(|item| item.id == proposal_id)
    .ok_or_else(|| "提案不存在".to_string())?;
  approve_import_proposal(&state, workspace, proposal, download_pdf).await
}

#[tauri::command]
pub async fn research_reject_proposal(
  state: State<'_, AppState>,
  session_id: String,
  proposal_id: String,
) -> Result<()> {
  let pool = open_research_pool(&state.library_dir).await?;
  let session = get_session_row(&pool, &session_id).await?;
  pool.close().await;
  let workspace = Path::new(&session.workspace_path);
  let mut proposals = read_proposals(workspace)?;
  let proposal = proposals
    .iter_mut()
    .find(|item| item.id == proposal_id)
    .ok_or_else(|| "提案不存在".to_string())?;
  if proposal.status != "pending" {
    return Err("该提案已处理".into());
  }
  proposal.status = "rejected".into();
  write_proposal(workspace, proposal)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn report_preview_truncates() {
    let text = "a".repeat(600);
    assert_eq!(report_preview(&text).len(), 500);
  }
}
