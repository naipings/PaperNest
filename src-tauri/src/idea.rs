//! 研究构思：主持 ResearchStudio IdeaSpark 的 idea 深度阶段，产出一张研究提案卡。
//! 提示词与模式表见 `idea_skill/`（MIT）。不运行上游 Python 质量账本、公式试跑、Phase 4 和 PDF。
use super::*;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::{Mutex, Semaphore};

const BOTTLENECK: &str = include_str!("idea_skill/prompts/bottleneck_identify.txt");
const SELECT: &str = include_str!("idea_skill/prompts/ideate_select.txt");
const GENERATE: &str = include_str!("idea_skill/prompts/ideate_generate.txt");
const CRITIQUE: &str = include_str!("idea_skill/prompts/critique.txt");
const REVISE: &str = include_str!("idea_skill/prompts/revise.txt");
const OVERVIEW: &str = include_str!("idea_skill/overview.md");
const COMPANIONS: &str = include_str!("idea_skill/companion-combos.md");
const SUBPATTERNS: &str = include_str!("idea_skill/subpatterns-overview.md");
const SCOOP: &str = include_str!("idea_skill/scoop_check.md");

const CANCELLED: &str = "构思已停止";
const MAX_PAPERS: usize = 20;
const STAGE_MAX_TOKENS: u32 = 8_000;

const HOST_PREAMBLE: &str = "\
HOST ADAPTER
You cannot read the filesystem. Each block below is the exact contents of the labeled path. Apply the system prompt to these blocks. Return only the JSON object that stage writes, with no markdown fence.
Individual C## sub-pattern cards are not in the file list. Use sub_pattern=null with sub_pattern_not_applicable_reason when the overview row is not enough to judge when_to_pick_this_one. Do not invent a C## code.
phase2_coherence/blocking_findings.json does not exist. Emit blocking_findings_disposition as an empty array.
";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaTask {
  pub id: String,
  pub title: String,
  pub direction: String,
  pub paper_ids: Vec<String>,
  pub workspace_path: String,
  pub status: String,
  pub stage: Option<String>,
  pub error: Option<String>,
  pub validation: Vec<String>,
  pub model: Option<String>,
  pub created_at: String,
  pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaDetail {
  pub task: IdeaTask,
  pub report: String,
  pub stages_done: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateIdeaInput {
  direction: String,
  #[serde(default)]
  paper_ids: Vec<String>,
}

struct LitPaper {
  paper_id: String,
  year_month: String,
  venue: String,
  title: String,
  abstract_text: String,
  retrieved_via: String,
}

struct RunControl {
  tokens: Mutex<HashMap<String, Arc<AtomicBool>>>,
  gate: Semaphore,
}

fn control() -> &'static RunControl {
  static CONTROL: OnceLock<RunControl> = OnceLock::new();
  CONTROL.get_or_init(|| RunControl { tokens: Mutex::new(HashMap::new()), gate: Semaphore::new(1) })
}

fn workspace_dir(library_dir: &Path, id: &str) -> PathBuf {
  library_dir.join("ideas").join(id)
}

fn row_task(library_dir: &Path, r: sqlx::sqlite::SqliteRow) -> Result<IdeaTask> {
  let id: String = r.get("id");
  let paper_ids = serde_json::from_str(r.get::<String, _>("paper_ids_json").as_str()).unwrap_or_default();
  let validation = serde_json::from_str(r.get::<String, _>("validation_json").as_str()).unwrap_or_default();
  Ok(IdeaTask {
    workspace_path: workspace_dir(library_dir, &id).to_string_lossy().into_owned(),
    id,
    title: r.get("title"),
    direction: r.get("direction"),
    paper_ids,
    status: r.get("status"),
    stage: r.get("stage"),
    error: r.get("error"),
    validation,
    model: r.get("model"),
    created_at: r.get("created_at"),
    updated_at: r.get("updated_at"),
  })
}

async fn load_task(pool: &SqlitePool, library_dir: &Path, id: &str) -> Result<IdeaTask> {
  let row = sqlx::query("SELECT * FROM idea_tasks WHERE id=?")
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(err)?
    .ok_or_else(|| "构思任务不存在".to_string())?;
  row_task(library_dir, row)
}

async fn set_status(pool: &SqlitePool, id: &str, status: &str, stage: Option<&str>, error: Option<&str>) -> Result<()> {
  sqlx::query("UPDATE idea_tasks SET status=?, stage=?, error=?, updated_at=? WHERE id=?")
    .bind(status)
    .bind(stage)
    .bind(error)
    .bind(Utc::now().to_rfc3339())
    .bind(id)
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

pub(crate) async fn reset_interrupted(pool: &SqlitePool) -> Result<()> {
  sqlx::query("UPDATE idea_tasks SET status='failed', stage=NULL, error=?, updated_at=? WHERE status IN ('queued','running')")
    .bind("上次运行随应用退出中断，可点击「继续生成」")
    .bind(Utc::now().to_rfc3339())
    .execute(pool)
    .await
    .map_err(err)?;
  Ok(())
}

fn stages_done(workspace: &Path) -> Vec<String> {
  let mut done = Vec::new();
  let mark = |name: &str, path: &Path, done: &mut Vec<String>| {
    if path.exists() {
      done.push(name.into());
    }
  };
  mark("retrieve", &workspace.join("phase0/lit_table.md"), &mut done);
  mark("bottleneck", &workspace.join("phase1/phase1_output.json"), &mut done);
  mark("select", &workspace.join("phase2_select/phase2_select_output.json"), &mut done);
  mark("generate", &workspace.join("phase2_generate/phase2_generate_output.json"), &mut done);
  mark("collision", &workspace.join("phase3_collision/collision.json"), &mut done);
  mark("audit", &workspace.join("phase3_critique/phase3_critique_output.json"), &mut done);
  if workspace.join("phase3_revise/final_candidate.json").exists() || workspace.join("phase3_revise/skipped.txt").exists() {
    done.push("revise".into());
  }
  mark("card", &workspace.join("idea.std.zh.md"), &mut done);
  done
}

fn read_report(workspace: &Path) -> Result<String> {
  let path = workspace.join("idea.std.zh.md");
  if !path.exists() {
    return Ok(String::new());
  }
  fs::read_to_string(path).map_err(err)
}

async fn ensure_not_cancelled(id: &str) -> Result<()> {
  let cancelled = control().tokens.lock().await.get(id).is_some_and(|token| token.load(Ordering::SeqCst));
  if cancelled {
    return Err(CANCELLED.into());
  }
  Ok(())
}

#[tauri::command]
pub async fn idea_list(state: State<'_, AppState>) -> Result<Vec<IdeaTask>> {
  let pool = state.pool.read().await;
  let rows = sqlx::query("SELECT * FROM idea_tasks ORDER BY updated_at DESC").fetch_all(&*pool).await.map_err(err)?;
  rows.into_iter().map(|row| row_task(&state.library_dir, row)).collect()
}

#[tauri::command]
pub async fn idea_get(state: State<'_, AppState>, id: String) -> Result<IdeaDetail> {
  let pool = state.pool.read().await;
  let task = load_task(&pool, &state.library_dir, &id).await?;
  let workspace = PathBuf::from(&task.workspace_path);
  Ok(IdeaDetail { report: read_report(&workspace)?, stages_done: stages_done(&workspace), task })
}

#[tauri::command]
pub async fn idea_create(state: State<'_, AppState>, input: CreateIdeaInput) -> Result<IdeaTask> {
  let direction = input.direction.trim().to_string();
  if direction.chars().count() < 8 {
    return Err("请把研究方向写清楚，至少 8 个字".into());
  }
  let pool = state.pool.read().await;
  for id in &input.paper_ids {
    let exists: Option<String> = sqlx::query_scalar("SELECT id FROM papers WHERE id=? AND deleted_at IS NULL")
      .bind(id)
      .fetch_optional(&*pool)
      .await
      .map_err(err)?;
    if exists.is_none() {
      return Err(format!("论文不存在或已删除：{id}"));
    }
  }
  let id = Uuid::new_v4().to_string();
  let title: String = direction.chars().take(40).collect();
  let workspace = workspace_dir(&state.library_dir, &id);
  fs::create_dir_all(&workspace).map_err(err)?;
  fs::write(
    workspace.join("intake.json"),
    serde_json::to_vec_pretty(&json!({"direction": direction, "paperIds": input.paper_ids})).map_err(err)?,
  )
  .map_err(err)?;
  let now = Utc::now().to_rfc3339();
  sqlx::query("INSERT INTO idea_tasks(id,title,direction,paper_ids_json,status,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?)")
    .bind(&id)
    .bind(&title)
    .bind(&direction)
    .bind(serde_json::to_string(&input.paper_ids).map_err(err)?)
    .bind(&now)
    .bind(&now)
    .execute(&*pool)
    .await
    .map_err(err)?;
  load_task(&pool, &state.library_dir, &id).await
}

#[tauri::command]
pub async fn idea_run(state: State<'_, AppState>, id: String, restart: bool) -> Result<IdeaTask> {
  let settings = crate::research::load_research_settings(&state.library_dir).await?;
  if !settings.enabled || !settings.api_key_saved {
    return Err("研究构思使用「设置 → 文献调研」的 LLM，请先启用并保存 API Key".into());
  }
  let pool = state.pool.read().await.clone();
  let task = load_task(&pool, &state.library_dir, &id).await?;
  {
    let mut tokens = control().tokens.lock().await;
    if tokens.contains_key(&id) {
      return Err("该构思仍在运行".into());
    }
    tokens.insert(id.clone(), Arc::new(AtomicBool::new(false)));
  }
  let prepared = async {
    if restart {
      for rel in ["phase0", "phase1", "phase2_select", "phase2_generate", "phase3_collision", "phase3_critique", "phase3_revise"] {
        let path = PathBuf::from(&task.workspace_path).join(rel);
        if path.exists() {
          fs::remove_dir_all(path).map_err(err)?;
        }
      }
      let card = PathBuf::from(&task.workspace_path).join("idea.std.zh.md");
      if card.exists() {
        fs::remove_file(card).map_err(err)?;
      }
      sqlx::query("UPDATE idea_tasks SET validation_json='[]' WHERE id=?").bind(&id).execute(&pool).await.map_err(err)?;
    }
    set_status(&pool, &id, "queued", None, None).await?;
    load_task(&pool, &state.library_dir, &id).await
  }
  .await;
  match prepared {
    Ok(queued) => {
      tauri::async_runtime::spawn(run_task(pool, settings, queued.clone()));
      Ok(queued)
    }
    Err(error) => {
      control().tokens.lock().await.remove(&id);
      Err(error)
    }
  }
}

#[tauri::command]
pub async fn idea_cancel(state: State<'_, AppState>, id: String) -> Result<IdeaTask> {
  if let Some(token) = control().tokens.lock().await.get(&id) {
    token.store(true, Ordering::SeqCst);
  }
  let pool = state.pool.read().await;
  load_task(&pool, &state.library_dir, &id).await
}

#[tauri::command]
pub async fn idea_save_report(state: State<'_, AppState>, id: String, report: String) -> Result<()> {
  let pool = state.pool.read().await;
  let task = load_task(&pool, &state.library_dir, &id).await?;
  if task.status == "queued" || task.status == "running" {
    return Err("生成进行中，不能编辑".into());
  }
  fs::write(PathBuf::from(&task.workspace_path).join("idea.std.zh.md"), report).map_err(err)?;
  sqlx::query("UPDATE idea_tasks SET updated_at=? WHERE id=?").bind(Utc::now().to_rfc3339()).bind(&id).execute(&*pool).await.map_err(err)?;
  Ok(())
}

#[tauri::command]
pub async fn idea_delete(state: State<'_, AppState>, id: String) -> Result<()> {
  let pool = state.pool.read().await;
  let task = load_task(&pool, &state.library_dir, &id).await?;
  if task.status == "queued" || task.status == "running" {
    return Err("构思仍在运行，先停止再删除".into());
  }
  let workspace = PathBuf::from(&task.workspace_path);
  if workspace.exists() {
    fs::remove_dir_all(&workspace).map_err(err)?;
  }
  sqlx::query("DELETE FROM idea_tasks WHERE id=?").bind(&id).execute(&*pool).await.map_err(err)?;
  Ok(())
}

async fn run_task(pool: SqlitePool, settings: crate::research::ResearchLlmSettings, task: IdeaTask) {
  let outcome = generate(&pool, &settings, &task).await;
  control().tokens.lock().await.remove(&task.id);
  let now = Utc::now().to_rfc3339();
  let query = match &outcome {
    Ok(notes) => sqlx::query("UPDATE idea_tasks SET status='completed', stage=NULL, error=NULL, validation_json=?, model=?, updated_at=? WHERE id=?")
      .bind(serde_json::json!(notes).to_string())
      .bind(&settings.model)
      .bind(&now)
      .bind(&task.id),
    Err(error) => sqlx::query("UPDATE idea_tasks SET status=?, stage=NULL, error=?, updated_at=? WHERE id=?")
      .bind(if error == CANCELLED { "cancelled" } else { "failed" })
      .bind(error)
      .bind(&now)
      .bind(&task.id),
  };
  if let Err(error) = query.execute(&pool).await {
    eprintln!("idea {}: 写入运行结果失败：{error}", task.id);
  }
}

async fn generate(pool: &SqlitePool, settings: &crate::research::ResearchLlmSettings, task: &IdeaTask) -> Result<Vec<String>> {
  let _permit = control().gate.acquire().await.map_err(err)?;
  ensure_not_cancelled(&task.id).await?;
  let workspace = PathBuf::from(&task.workspace_path);
  let mut notes = Vec::new();

  set_status(pool, &task.id, "running", Some("retrieve"), None).await?;
  if !workspace.join("phase0/lit_table.md").exists() {
    ensure_not_cancelled(&task.id).await?;
    let (papers, errors) = retrieve(pool, &task.direction, &task.paper_ids).await?;
    notes.extend(errors);
    write_literature(&workspace, &papers)?;
  }

  let query = fs::read_to_string(workspace.join("intake.json")).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok()).and_then(|v| v.get("direction").and_then(|d| d.as_str()).map(str::to_string)).unwrap_or_else(|| task.direction.clone());
  let lit = fs::read_to_string(workspace.join("phase0/lit_table.md")).map_err(err)?;
  let grounding = fs::read_to_string(workspace.join("phase0/.lit_grounding_mode")).map_err(err)?;
  let fulltext = fs::read_to_string(workspace.join("phase0/fulltext_cache.json")).map_err(err)?;

  ensure_not_cancelled(&task.id).await?;
  let phase1 = stage_json(
    pool,
    settings,
    task,
    "bottleneck",
    &workspace.join("phase1/phase1_output.json"),
    BOTTLENECK,
    &[
      ("$RUN_DIR/intake/user_query.txt", query.as_str()),
      ("$RUN_DIR/phase0/.lit_grounding_mode", grounding.as_str()),
      ("$RUN_DIR/phase0/lit_table.md", lit.as_str()),
      ("$RUN_DIR/phase0/fulltext_cache.json", fulltext.as_str()),
    ],
  )
  .await?;

  ensure_not_cancelled(&task.id).await?;
  let phase2 = stage_json(
    pool,
    settings,
    task,
    "select",
    &workspace.join("phase2_select/phase2_select_output.json"),
    SELECT,
    &[
      ("$RUN_DIR/intake/user_query.txt", query.as_str()),
      ("$RUN_DIR/phase1/phase1_output.json", phase1.as_str()),
      ("references/ideation-patterns/overview.md", OVERVIEW),
      ("references/ideation-patterns/companion-combos.md", COMPANIONS),
      ("$RUN_DIR/phase0/lit_table.md", lit.as_str()),
    ],
  )
  .await?;

  ensure_not_cancelled(&task.id).await?;
  let candidate_text = stage_json(
    pool,
    settings,
    task,
    "generate",
    &workspace.join("phase2_generate/phase2_generate_output.json"),
    GENERATE,
    &[
      ("$RUN_DIR/intake/user_query.txt", query.as_str()),
      ("$RUN_DIR/phase1/phase1_output.json", phase1.as_str()),
      ("$RUN_DIR/phase2_select/phase2_select_output.json", phase2.as_str()),
      ("references/ideation-patterns/overview.md", OVERVIEW),
      ("references/ideation-sub-patterns/overview.md", SUBPATTERNS),
      ("$RUN_DIR/phase0/lit_table.md", lit.as_str()),
    ],
  )
  .await?;

  ensure_not_cancelled(&task.id).await?;
  let collision_text = if workspace.join("phase3_collision/collision.json").exists() {
    fs::read_to_string(workspace.join("phase3_collision/collision.json")).map_err(err)?
  } else {
    set_status(pool, &task.id, "running", Some("collision"), None).await?;
    let candidate: Value = serde_json::from_str(&candidate_text).map_err(err)?;
    let hits = collision_search(&candidate, &query).await?;
    let hits_text = serde_json::to_string_pretty(&hits).map_err(err)?;
    let mechanism = text_field(&candidate, "core_mechanism");
    let raw = complete_json(
      settings,
      SCOOP,
      &host_user(&[
        ("research problem", query.as_str()),
        ("claimed novelty / core_mechanism", mechanism.as_str()),
        ("paper-search results JSON", hits_text.as_str()),
      ]),
    )
    .await?;
    write_json_text(&workspace.join("phase3_collision/collision.json"), &raw)?;
    raw
  };

  ensure_not_cancelled(&task.id).await?;
  let critique_text = stage_json(
    pool,
    settings,
    task,
    "audit",
    &workspace.join("phase3_critique/phase3_critique_output.json"),
    CRITIQUE,
    &[
      ("$RUN_DIR/phase2_generate/phase2_generate_output.json", candidate_text.as_str()),
      ("$RUN_DIR/phase3_collision/collision.json", collision_text.as_str()),
      ("$RUN_DIR/phase0/lit_table.md", lit.as_str()),
    ],
  )
  .await?;
  let critique: Value = serde_json::from_str(&critique_text).map_err(err)?;
  let verdict = critique.get("verdict").and_then(|v| v.as_str()).unwrap_or("").to_string();

  ensure_not_cancelled(&task.id).await?;
  let final_candidate = if workspace.join("phase3_revise/final_candidate.json").exists() {
    fs::read_to_string(workspace.join("phase3_revise/final_candidate.json")).map_err(err)?
  } else if workspace.join("phase3_revise/skipped.txt").exists() {
    candidate_text.clone()
  } else if verdict == "revise" {
    set_status(pool, &task.id, "running", Some("revise"), None).await?;
    let patch_text = complete_json(
      settings,
      REVISE,
      &host_user(&[
        ("$RUN_DIR/phase2_generate/phase2_generate_output.json", candidate_text.as_str()),
        ("$RUN_DIR/phase3_critique/phase3_critique_output.json", critique_text.as_str()),
      ]),
    )
    .await?;
    write_json_text(&workspace.join("phase3_revise/phase3_revise_output.json"), &patch_text)?;
    let patch: Value = serde_json::from_str(&patch_text).map_err(err)?;
    let base: Value = serde_json::from_str(&candidate_text).map_err(err)?;
    let merged = apply_revisions(&base, &patch, &critique)?;
    let merged_text = serde_json::to_string_pretty(&merged).map_err(err)?;
    write_json_text(&workspace.join("phase3_revise/final_candidate.json"), &merged_text)?;
    merged_text
  } else {
    fs::write(workspace.join("phase3_revise/skipped.txt"), format!("verdict={verdict}")).map_err(err)?;
    candidate_text.clone()
  };

  if !workspace.join("idea.std.zh.md").exists() {
    set_status(pool, &task.id, "running", Some("card"), None).await?;
    let candidate: Value = serde_json::from_str(&final_candidate).map_err(err)?;
    let collision: Value = serde_json::from_str(&collision_text).unwrap_or(Value::Null);
    let card = render_card(&task.title, &query, &candidate, &collision, &critique, &lit);
    fs::write(workspace.join("idea.std.zh.md"), &card).map_err(err)?;
  }
  if verdict == "abandon" {
    notes.push("审计结论为 abandon，卡片仍保留为未通过审计的提案".into());
  }
  Ok(notes)
}

async fn stage_json(
  pool: &SqlitePool,
  settings: &crate::research::ResearchLlmSettings,
  task: &IdeaTask,
  stage: &str,
  path: &Path,
  system: &str,
  files: &[(&str, &str)],
) -> Result<String> {
  if path.exists() {
    return fs::read_to_string(path).map_err(err);
  }
  set_status(pool, &task.id, "running", Some(stage), None).await?;
  let text = complete_json(settings, system, &host_user(files)).await?;
  write_json_text(path, &text)?;
  Ok(text)
}

async fn complete_json(settings: &crate::research::ResearchLlmSettings, system: &str, user: &str) -> Result<String> {
  let raw = crate::research_llm::research_llm_completion(settings, system, json!(user), Some(STAGE_MAX_TOKENS), 300).await?;
  let value = parse_model_json(&raw)?;
  serde_json::to_string_pretty(&value).map_err(err)
}

fn write_json_text(path: &Path, text: &str) -> Result<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent).map_err(err)?;
  }
  fs::write(path, text).map_err(err)
}

fn host_user(files: &[(&str, &str)]) -> String {
  let mut out = String::from(HOST_PREAMBLE);
  out.push('\n');
  for (path, body) in files {
    out.push_str("===== ");
    out.push_str(path);
    out.push_str(" =====\n");
    out.push_str(body);
    out.push_str("\n\n");
  }
  if out.chars().count() > 90_000 {
    out = out.chars().take(90_000).collect();
    out.push_str("\n\n[host truncated the user message]\n");
  }
  out
}

async fn retrieve(pool: &SqlitePool, direction: &str, paper_ids: &[String]) -> Result<(Vec<LitPaper>, Vec<String>)> {
  let mut papers = Vec::new();
  let mut errors = Vec::new();
  for id in paper_ids {
    let row = sqlx::query("SELECT id, title_en, abstract_en, summary, venue, doi, arxiv_id FROM papers WHERE id=? AND deleted_at IS NULL")
      .bind(id)
      .fetch_optional(pool)
      .await
      .map_err(err)?
      .ok_or_else(|| format!("论文不存在或已删除：{id}"))?;
    let title: String = row.get("title_en");
    let abstract_en: Option<String> = row.get("abstract_en");
    let summary: Option<String> = row.get("summary");
    let venue: Option<String> = row.get("venue");
    papers.push(LitPaper {
      paper_id: format!("library:{id}"),
      year_month: "unknown".into(),
      venue: venue.unwrap_or_else(|| "library".into()),
      title,
      abstract_text: abstract_en.or(summary).unwrap_or_default(),
      retrieved_via: "library".into(),
    });
  }
  let phrase = search_phrase(direction);
  match crate::radar::search_arxiv_briefs(&phrase, 8).await {
    Ok(items) => {
      for item in items {
        papers.push(LitPaper {
          paper_id: format!("arxiv:{}", item.arxiv_id),
          year_month: "unknown".into(),
          venue: "arXiv".into(),
          title: item.title,
          abstract_text: item.abstract_text,
          retrieved_via: "arxiv".into(),
        });
      }
    }
    Err(error) => errors.push(format!("arXiv：{error}")),
  }
  match crate::research_web::search_openalex_sources(&phrase, 8, Some(2021)).await {
    Ok(items) => {
      for item in items.into_iter().filter(|item| item.kind == "openalex" || item.kind == "crossref") {
        papers.push(LitPaper {
          paper_id: item.url.clone(),
          year_month: "unknown".into(),
          venue: item.kind.clone(),
          title: item.title,
          abstract_text: item.excerpt,
          retrieved_via: item.kind,
        });
      }
    }
    Err(error) => errors.push(format!("OpenAlex/Crossref：{error}")),
  }
  dedupe_papers(&mut papers);
  if papers.is_empty() {
    let extra = if errors.is_empty() { String::new() } else { format!(" {}", errors.join("；")) };
    return Err(format!("没有检索到文献。可勾选论文库中的种子论文，或检查网络。{extra}"));
  }
  papers.truncate(MAX_PAPERS);
  Ok((papers, errors))
}

fn search_phrase(direction: &str) -> String {
  let tokens = crate::search_query::search_tokenize(direction);
  let phrase = tokens.into_iter().take(8).collect::<Vec<_>>().join(" ");
  if phrase.is_empty() {
    direction.chars().take(80).collect()
  } else {
    phrase
  }
}

fn dedupe_papers(papers: &mut Vec<LitPaper>) {
  let mut seen = HashSet::new();
  papers.retain(|paper| seen.insert(norm_title(&paper.title)));
}

fn norm_title(title: &str) -> String {
  title.to_lowercase().chars().filter(|c| !c.is_whitespace()).collect()
}

fn write_literature(workspace: &Path, papers: &[LitPaper]) -> Result<()> {
  let phase0 = workspace.join("phase0");
  fs::create_dir_all(&phase0).map_err(err)?;
  fs::write(phase0.join(".lit_grounding_mode"), "real").map_err(err)?;
  fs::write(phase0.join("lit_table.md"), lit_table(papers)).map_err(err)?;
  let entries: Vec<Value> = papers
    .iter()
    .map(|paper| json!({"paper_id": paper.paper_id, "source_used": "failed", "reason": "host stored the abstract only"}))
    .collect();
  fs::write(phase0.join("fulltext_cache.json"), serde_json::to_vec_pretty(&json!({"papers": entries})).map_err(err)?).map_err(err)?;
  Ok(())
}

fn lit_table(papers: &[LitPaper]) -> String {
  let mut out = String::from("| paper_id | year_month | venue | title | ideation pattern tags | bottleneck this paper targets | open issue / unresolved gap | resolves_problem | retrieved_via |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |\n");
  for paper in papers {
    let excerpt = cell(&paper.abstract_text);
    out.push_str(&format!(
      "| {} | {} | {} | {} | untagged | {} | {} | unknown | {} |\n",
      cell(&paper.paper_id),
      cell(&paper.year_month),
      cell(&paper.venue),
      cell(&paper.title),
      excerpt,
      excerpt,
      cell(&paper.retrieved_via),
    ));
  }
  out.push_str("\nPattern tags were not produced. The bottleneck and open-issue columns quote the abstract. Full text was not fetched.\n");
  out
}

fn cell(value: &str) -> String {
  value.replace('|', "\\|").replace(['\n', '\r'], " ").chars().take(280).collect()
}

async fn collision_search(candidate: &Value, direction: &str) -> Result<Vec<Value>> {
  let mut queries = Vec::new();
  if let Some(terms) = candidate.get("signature_terms").and_then(|v| v.as_array()) {
    for term in terms.iter().take(3) {
      let text = term.as_str().or_else(|| term.get("term").and_then(|v| v.as_str())).unwrap_or("").trim().to_string();
      if !text.is_empty() {
        queries.push(text);
      }
    }
  }
  if queries.is_empty() {
    queries.push(search_phrase(direction));
  }
  let mut hits = Vec::new();
  for query in queries {
    if let Ok(items) = crate::radar::search_arxiv_briefs(&query, 5).await {
      for item in items {
        hits.push(json!({"title": item.title, "url": item.abs_url, "abstract": item.abstract_text, "source": "arxiv", "query": query}));
      }
    }
    if let Ok(items) = crate::research_web::search_openalex_sources(&query, 5, Some(2021)).await {
      for item in items.into_iter().filter(|item| item.kind == "openalex" || item.kind == "crossref") {
        hits.push(json!({"title": item.title, "url": item.url, "abstract": item.excerpt, "source": item.kind, "query": query}));
      }
    }
  }
  let mut seen = HashSet::new();
  hits.retain(|hit| seen.insert(norm_title(hit.get("title").and_then(|v| v.as_str()).unwrap_or(""))));
  hits.truncate(24);
  Ok(hits)
}

fn render_card(title: &str, direction: &str, candidate: &Value, collision: &Value, critique: &Value, lit: &str) -> String {
  let heading = text_field(candidate, "title");
  let heading = if heading.trim().is_empty() { title.to_string() } else { heading };
  let verdict = critique.get("verdict").and_then(|v| v.as_str()).unwrap_or("未给出");
  let rationale = text_field(critique, "verdict_rationale");
  let level = collision.get("level").map(|v| v.to_string()).unwrap_or_else(|| "未给出".into());
  let summary = text_field(collision, "summary");
  let mut card = format!(
    "# {heading}\n\n> 这是研究提案，不是实验结果。审计结论：{verdict}。\n\n## 方向\n\n{direction}\n\n## 动机\n\n{}\n\n## 方法\n\n{}\n\n## 可证伪预测\n\n{}\n\n## 与最近文献的差别\n\n{}\n\n## 先验撞车\n\n等级：{level}\n\n{summary}\n\n## 审计\n\n{rationale}\n\n## 检索文献\n\n{lit}\n\n---\n\n来源流程：Microsoft ResearchStudio IdeaSpark（MIT，arXiv:2607.04439）。PaperNest 主持了检索、瓶颈、选模式、生成、撞车、审计和修订。未运行质量门控、公式试跑、Phase 4 技术展开和 PDF 渲染。文献只有摘要。\n",
    text_or_json(candidate, "hook"),
    text_or_json(candidate, "core_mechanism"),
    text_or_json(candidate, "falsification_prediction"),
    text_or_json(candidate, "differentiation_from_lit"),
  );
  if card.contains("未给出") && summary.is_empty() {
    card.push_str("\n撞车阶段没有返回 summary。\n");
  }
  card
}

fn text_field(value: &Value, key: &str) -> String {
  match value.get(key) {
    Some(Value::String(text)) => text.clone(),
    Some(other) if !other.is_null() => serde_json::to_string_pretty(other).unwrap_or_default(),
    _ => String::new(),
  }
}

fn text_or_json(value: &Value, key: &str) -> String {
  let text = text_field(value, key);
  if text.trim().is_empty() { "（候选 JSON 没有这个字段）".into() } else { text }
}

fn parse_model_json(text: &str) -> Result<Value> {
  let trimmed = text.trim();
  let start = trimmed.find('{').ok_or("模型没有返回 JSON 对象")?;
  let end = trimmed.rfind('}').ok_or("模型没有返回 JSON 对象")?;
  serde_json::from_str(&trimmed[start..=end]).map_err(|error| format!("模型 JSON 无法解析：{error}"))
}

struct PathStep {
  key: String,
  index: Option<usize>,
}

fn path_steps(path: &str) -> Result<Vec<PathStep>> {
  if path.is_empty() {
    return Err("修订路径为空".into());
  }
  path
    .split('.')
    .map(|part| {
      if part.is_empty() {
        return Err(format!("修订路径无效：{path}"));
      }
      if let Some(bracket) = part.find('[') {
        let key = part[..bracket].to_string();
        let index: usize = part[bracket + 1..].trim_end_matches(']').parse().map_err(|_| format!("修订路径索引无效：{part}"))?;
        Ok(PathStep { key, index: Some(index) })
      } else {
        Ok(PathStep { key: part.to_string(), index: None })
      }
    })
    .collect()
}

fn apply_revisions(candidate: &Value, patch: &Value, critique: &Value) -> Result<Value> {
  let mut merged = candidate.clone();
  let ops = patch.get("applied_revisions").and_then(|v| v.as_array()).ok_or("修订结果缺少 applied_revisions")?;
  let mut rewrites = 0;
  for op in ops {
    let outcome = op.get("outcome").and_then(|v| v.as_str()).unwrap_or("applied");
    if outcome.starts_with("skipped") {
      continue;
    }
    let kind = op.get("op").and_then(|v| v.as_str()).ok_or("修订缺少 op")?;
    let field = op.get("field").and_then(|v| v.as_str()).ok_or("修订缺少 field")?;
    let value = op.get("value").cloned().ok_or("修订缺少 value")?;
    if kind == "rewrite_falsification" {
      rewrites += 1;
      if rewrites > 1 {
        return Err("rewrite_falsification 最多一条".into());
      }
      if !falsification_authorized(critique) {
        return Err("审计没有授权修改 falsification_prediction".into());
      }
    }
    apply_op(&mut merged, kind, field, &value)?;
  }
  Ok(merged)
}

fn falsification_authorized(critique: &Value) -> bool {
  critique.get("revision_targets").and_then(|v| v.as_array()).is_some_and(|targets| {
    targets.iter().any(|target| target.get("scope").and_then(|v| v.as_str()) == Some("falsification"))
  })
}

fn apply_op(candidate: &mut Value, op: &str, field: &str, value: &Value) -> Result<()> {
  if op == "swap_sub_pattern" {
    let gaps = candidate.get_mut("gap_closure").and_then(|v| v.as_array_mut()).ok_or("候选没有 gap_closure")?;
    let entry = gaps.iter_mut().find(|gap| gap.get("gap").and_then(|v| v.as_str()) == Some(field)).ok_or_else(|| format!("找不到 gap：{field}"))?;
    entry["sub_pattern"] = value.clone();
    return Ok(());
  }
  let root = field.split(['.', '[']).next().unwrap_or(field);
  if root == "compute_budget" || (root == "falsification_prediction" && op != "rewrite_falsification") {
    return Err(format!("拒绝修改 {root}"));
  }
  match op {
    "replace" | "rewrite_falsification" => {
      if op == "rewrite_falsification" && field != "falsification_prediction" {
        return Err("rewrite_falsification 的 field 必须是 falsification_prediction".into());
      }
      set_path(candidate, field, value.clone())
    }
    "append_sentence" => {
      let current = get_path(candidate, field).ok().and_then(|v| v.as_str()).unwrap_or("");
      let extra = value.as_str().ok_or("append_sentence 的 value 必须是字符串")?;
      let next = format!("{current} {extra}").trim().to_string();
      set_path(candidate, field, Value::String(next))
    }
    "append_items" => {
      let extra = value.as_array().ok_or("append_items 的 value 必须是数组")?;
      let mut items = get_path(candidate, field).ok().and_then(|v| v.as_array()).cloned().unwrap_or_default();
      items.extend(extra.clone());
      set_path(candidate, field, Value::Array(items))
    }
    other => Err(format!("未知修订操作 {other}")),
  }
}

fn get_path<'a>(node: &'a Value, path: &str) -> Result<&'a Value> {
  let steps = path_steps(path)?;
  let mut cursor = node;
  for step in steps {
    cursor = cursor.get(&step.key).ok_or_else(|| format!("缺少字段 {}", step.key))?;
    if let Some(index) = step.index {
      cursor = cursor.as_array().ok_or_else(|| format!("{} 不是数组", step.key))?.get(index).ok_or_else(|| format!("{} 越界", step.key))?;
    }
  }
  Ok(cursor)
}

fn set_path(node: &mut Value, path: &str, value: Value) -> Result<()> {
  set_steps(node, &path_steps(path)?, value)
}

fn set_steps(node: &mut Value, steps: &[PathStep], value: Value) -> Result<()> {
  let step = steps.first().ok_or("修订路径为空")?;
  let obj = node.as_object_mut().ok_or("路径经过的节点不是对象")?;
  if !obj.contains_key(&step.key) || obj.get(&step.key).is_some_and(|v| v.is_null()) {
    let placeholder = if step.index.is_some() {
      Value::Array(vec![])
    } else if steps.len() == 1 {
      Value::Null
    } else {
      json!({})
    };
    obj.insert(step.key.clone(), placeholder);
  }
  let child = obj.get_mut(&step.key).ok_or("路径写入失败")?;
  if let Some(index) = step.index {
    let arr = child.as_array_mut().ok_or_else(|| format!("{} 不是数组", step.key))?;
    let item = arr.get_mut(index).ok_or_else(|| format!("{} 越界", step.key))?;
    if steps.len() == 1 {
      *item = value;
      return Ok(());
    }
    return set_steps(item, &steps[1..], value);
  }
  if steps.len() == 1 {
    *child = value;
    return Ok(());
  }
  set_steps(child, &steps[1..], value)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn prompt_is_the_upstream_phase_text() {
    assert!(BOTTLENECK.contains("Bottleneck Identification"));
    assert!(SELECT.contains("Gap × Pattern Selection"));
    assert!(SCOOP.contains("Scoop Check"));
  }

  #[test]
  fn parse_json_ignores_a_fence() {
    let value = parse_model_json("说明\n```json\n{\"verdict\":\"advance\"}\n```").unwrap();
    assert_eq!(value["verdict"], "advance");
  }

  #[test]
  fn lit_table_uses_the_upstream_columns() {
    let table = lit_table(&[LitPaper {
      paper_id: "arxiv:1".into(),
      year_month: "unknown".into(),
      venue: "arXiv".into(),
      title: "A|B".into(),
      abstract_text: "gap".into(),
      retrieved_via: "arxiv".into(),
    }]);
    assert!(table.contains("paper_id | year_month | venue | title | ideation pattern tags"));
    assert!(table.contains("A\\|B"));
    assert!(table.contains("untagged"));
  }

  #[test]
  fn revision_replaces_and_appends() {
    let base = json!({"core_mechanism": "先做甲。", "signature_terms": ["a"]});
    let patch = json!({"applied_revisions": [
      {"op": "append_sentence", "field": "core_mechanism", "value": "再做乙。", "outcome": "applied"},
      {"op": "append_items", "field": "signature_terms", "value": ["b"], "outcome": "applied"},
      {"op": "replace", "field": "hook", "value": "一句动机", "outcome": "applied"}
    ]});
    let merged = apply_revisions(&base, &patch, &json!({})).unwrap();
    assert_eq!(merged["core_mechanism"], "先做甲。 再做乙。");
    assert_eq!(merged["signature_terms"], json!(["a", "b"]));
    assert_eq!(merged["hook"], "一句动机");
  }

  #[test]
  fn revision_refuses_compute_budget_and_unauthorized_falsification() {
    let base = json!({"compute_budget": "1 gpu", "falsification_prediction": "旧预测"});
    let budget = json!({"applied_revisions": [{"op": "replace", "field": "compute_budget", "value": "2 gpu", "outcome": "applied"}]});
    assert!(apply_revisions(&base, &budget, &json!({})).unwrap_err().contains("compute_budget"));
    let rewrite = json!({"applied_revisions": [{"op": "rewrite_falsification", "field": "falsification_prediction", "value": "新预测", "outcome": "applied"}]});
    assert!(apply_revisions(&base, &rewrite, &json!({})).unwrap_err().contains("没有授权"));
    let critique = json!({"revision_targets": [{"scope": "falsification"}]});
    let merged = apply_revisions(&base, &rewrite, &critique).unwrap();
    assert_eq!(merged["falsification_prediction"], "新预测");
    assert_eq!(merged["compute_budget"], "1 gpu");
  }

  #[test]
  fn card_states_the_proposal_boundary() {
    let card = render_card(
      "标题",
      "研究方向",
      &json!({"hook": "动机句", "core_mechanism": "方法句"}),
      &json!({"level": 4, "summary": "没有整段撞车"}),
      &json!({"verdict": "advance", "verdict_rationale": "机制还没被摘要覆盖"}),
      "| paper_id |\n",
    );
    assert!(card.contains("研究提案，不是实验结果"));
    assert!(card.contains("动机句"));
    assert!(card.contains("未运行质量门控"));
  }
}
