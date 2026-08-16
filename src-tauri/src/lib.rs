mod online_metadata;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Row, SqlitePool};
use std::{env, fs, io::{Read, Write}, path::{Path, PathBuf}, process::Command, str::FromStr};
use tauri::{Manager, State};
use tokio::sync::RwLock;
use uuid::Uuid;
use walkdir::WalkDir;
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};
use reqwest::Client;
use std::time::Duration;

type Result<T> = std::result::Result<T, String>;

struct AppState { library_dir: PathBuf, location_config: PathBuf, pool: RwLock<SqlitePool> }

#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Author { id: String, name: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Category { id: String, name: String, color: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Tag { id: String, name: String, color: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Paper {
  id: String, title_en: String, title_zh: Option<String>, authors: Vec<Author>, category_id: Option<String>, tag_ids: Vec<String>, status: String,
  summary: Option<String>, abstract_en: Option<String>, abstract_zh: Option<String>, venue: Option<String>, publication_date: Option<String>, doi: Option<String>, arxiv_id: Option<String>, source_url: Option<String>,
  pdf_path: Option<String>, pdf_sha256: Option<String>, page_count: Option<i64>, has_text_layer: Option<bool>, favorite: bool, reading_page: Option<i64>,
  created_at: String, updated_at: String, deleted_at: Option<String>, #[serde(default)] related_paper_ids: Vec<String>
}
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Annotation { id: String, paper_id: String, page: i64, r#type: String, geometry: serde_json::Value, quote: Option<String>, comment: Option<String>, color: String, created_at: String, updated_at: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct VocabularyEntry { id: String, paper_id: String, term_en: String, meaning_zh: String, sentence_en: Option<String>, sentence_zh: Option<String>, page: Option<i64>, annotation_id: Option<String>, note: Option<String> }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct FrameworkFigure { id: String, paper_id: String, image_path: String, title: Option<String>, explanation_en: Option<String>, explanation_zh: Option<String>, page: Option<i64>, geometry: Option<serde_json::Value>, is_primary: bool }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct WritingExcerpt { id: String, paper_id: String, source_text: String, translation_zh: Option<String>, purpose: String, personal_rewrite: Option<String>, page: Option<i64>, annotation_id: Option<String>, tags: Vec<String>, created_at: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct SavedView { id: String, name: String, builtin: Option<bool>, filter: serde_json::Value, sorting: serde_json::Value, column_visibility: serde_json::Value, density: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Profile { display_name: String, research_field: String, avatar_path: Option<String>, theme: String }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct Task { id: String, title: String, notes: Option<String>, due_date: Option<String>, status: String, priority: String, paper_id: Option<String>, created_at: String, updated_at: String, completed_at: Option<String> }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct PaperDayRead { day: String, paper_id: String, seconds: i64 }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct LibrarySnapshot { papers: Vec<Paper>, categories: Vec<Category>, tags: Vec<Tag>, annotations: Vec<Annotation>, vocabulary: Vec<VocabularyEntry>, figures: Vec<FrameworkFigure>, excerpts: Vec<WritingExcerpt>, tasks: Vec<Task>, reading_days: Vec<PaperDayRead>, views: Vec<SavedView>, profile: Profile, llm: LlmSettings, metadata: online_metadata::OnlineMetadataSettings, library_path: String }
#[derive(Deserialize, Serialize)] struct PageText { page: i64, text: String }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct SearchHit { kind: String, paper_id: String, title: String, snippet: String, page: Option<i64>, score: f64 }
#[derive(Clone, Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct LlmSettings {
  base_url: String, model: String, auto_analyze_on_import: bool, vision_enabled: bool,
  #[serde(default)] api_key_saved: bool
}
#[derive(Deserialize)] #[serde(rename_all="camelCase")]
struct LlmPageImage { page: i64, data_url: String }
#[derive(Deserialize)] #[serde(rename_all="camelCase")]
struct LlmAnalysisInput { text: String, candidate_images: Vec<LlmPageImage> }
#[derive(Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct LlmAnalysis {
  title_en: Option<String>, title_zh: Option<String>, authors: Option<Vec<String>>, abstract_en: Option<String>, abstract_zh: Option<String>, summary: Option<String>, venue: Option<String>, publication_date: Option<String>, doi: Option<String>, source_url: Option<String>, framework_page: Option<i64>, framework_title: Option<String>, framework_explanation_en: Option<String>, framework_explanation_zh: Option<String>, vocabulary: Option<Vec<LlmVocabularySuggestion>>
}
#[derive(Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct LlmVocabularySuggestion { term_en: String, meaning_zh: String, sentence_en: Option<String>, sentence_zh: Option<String>, page: Option<i64> }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct DuplicateCandidate { paper_id: String, title: String, reason: String }
#[derive(Serialize)] #[serde(rename_all="camelCase")]
struct ImportedPaper { paper: Paper, is_new: bool }
#[derive(Serialize, Deserialize)] #[serde(rename_all="camelCase")]
struct LibraryLocation {
  #[serde(alias = "libraryPath")]
  library_path: String,
}

fn read_library_location(config: &Path) -> Option<PathBuf> {
  let raw = fs::read_to_string(config).ok()?;
  let saved: LibraryLocation = serde_json::from_str(raw.trim()).ok()?;
  let path = PathBuf::from(saved.library_path.trim());
  if path.is_absolute() { Some(path) } else { None }
}

fn resolve_library_dir(app:&tauri::App)->Result<(PathBuf,PathBuf)> { let config_dir=app.path().app_config_dir().map_err(err)?; fs::create_dir_all(&config_dir).map_err(err)?; let config=config_dir.join("library-location.json"); if let Some(path)=read_library_location(&config) { return Ok((path,config)); } let legacy=app.path().app_local_data_dir().map_err(err)?.join("PaperNestLibrary"); if legacy.join("library.db").exists() { return Ok((legacy,config)); } let documents=app.path().document_dir().or_else(|_|app.path().app_local_data_dir()).map_err(err)?; Ok((documents.join("PaperNestLibrary"),config)) }
fn copy_library(source:&Path,target:&Path)->Result<()> { for entry in WalkDir::new(source).into_iter().filter_map(|e|e.ok()) { let path=entry.path(); let relative=path.strip_prefix(source).map_err(err)?; let destination=target.join(relative); if entry.file_type().is_dir() { fs::create_dir_all(&destination).map_err(err)?; } else if entry.file_type().is_file() { if let Some(parent)=destination.parent(){fs::create_dir_all(parent).map_err(err)?;} fs::copy(path,&destination).map_err(err)?; } } Ok(()) }
fn tesseract_executable()->PathBuf { if let Ok(program_files)=env::var("ProgramFiles") { let candidate=PathBuf::from(program_files).join("Tesseract-OCR").join("tesseract.exe"); if candidate.exists(){return candidate;} } PathBuf::from("tesseract") }


async fn open_pool(dir: &Path) -> Result<SqlitePool> {
  fs::create_dir_all(dir.join("pdf/originals")).map_err(err)?; fs::create_dir_all(dir.join("figures")).map_err(err)?; fs::create_dir_all(dir.join("avatars")).map_err(err)?; fs::create_dir_all(dir.join("backups")).map_err(err)?;
  let db_path = dir.join("library.db");
  let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db_path.to_string_lossy())).map_err(err)?.create_if_missing(true).foreign_keys(true);
  let pool = SqlitePoolOptions::new().max_connections(5).connect_with(options).await.map_err(err)?;
  for statement in include_str!("schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) { sqlx::query(statement).execute(&pool).await.map_err(err)?; }
  let _ = sqlx::query("ALTER TABLE papers ADD COLUMN related_paper_ids_json TEXT NOT NULL DEFAULT '[]'").execute(&pool).await;
  let manifest = serde_json::json!({"application":"PaperNest","schemaVersion":1,"createdAt":Utc::now().to_rfc3339()});
  if !dir.join("manifest.json").exists() { fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&manifest).map_err(err)?).map_err(err)?; }
  Ok(pool)
}

#[tauri::command]
async fn initialize_library(state: State<'_, AppState>) -> Result<LibrarySnapshot> { let pool = state.pool.read().await; load_snapshot(&pool, &state.library_dir).await }

async fn load_snapshot(pool: &SqlitePool, dir: &Path) -> Result<LibrarySnapshot> {
  let papers = sqlx::query("SELECT * FROM papers ORDER BY favorite DESC, updated_at DESC").fetch_all(pool).await.map_err(err)?.into_iter().map(row_paper).collect::<Result<Vec<_>>>()?;
  let categories = sqlx::query("SELECT id,name,color FROM categories ORDER BY name").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| Category { id:r.get(0),name:r.get(1),color:r.get(2) }).collect();
  let tags = sqlx::query("SELECT id,name,color FROM tags ORDER BY name").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| Tag { id:r.get(0),name:r.get(1),color:r.get(2) }).collect();
  let annotations = sqlx::query("SELECT * FROM annotations ORDER BY page,created_at").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| Ok(Annotation { id:r.get("id"), paper_id:r.get("paper_id"), page:r.get("page"), r#type:r.get("type"), geometry:serde_json::from_str(r.get::<String,_>("geometry_json").as_str()).map_err(err)?, quote:r.get("quote"), comment:r.get("comment"), color:r.get("color"), created_at:r.get("created_at"), updated_at:r.get("updated_at") })).collect::<Result<Vec<_>>>()?;
  let vocabulary = sqlx::query("SELECT * FROM vocabulary ORDER BY term_en").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| VocabularyEntry { id:r.get("id"),paper_id:r.get("paper_id"),term_en:r.get("term_en"),meaning_zh:r.get("meaning_zh"),sentence_en:r.get("sentence_en"),sentence_zh:r.get("sentence_zh"),page:r.get("page"),annotation_id:r.get("annotation_id"),note:r.get("note") }).collect();
  let figures = sqlx::query("SELECT * FROM figures").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| { let raw:Option<String>=r.get("geometry_json"); Ok(FrameworkFigure { id:r.get("id"),paper_id:r.get("paper_id"),image_path:r.get("image_path"),title:r.get("title"),explanation_en:r.get("explanation_en"),explanation_zh:r.get("explanation_zh"),page:r.get("page"),geometry:raw.map(|v| serde_json::from_str(&v)).transpose().map_err(err)?,is_primary:r.get::<i64,_>("is_primary") != 0 }) }).collect::<Result<Vec<_>>>()?;
  let excerpts = sqlx::query("SELECT * FROM excerpts ORDER BY created_at DESC").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| Ok(WritingExcerpt { id:r.get("id"),paper_id:r.get("paper_id"),source_text:r.get("source_text"),translation_zh:r.get("translation_zh"),purpose:r.get("purpose"),personal_rewrite:r.get("personal_rewrite"),page:r.get("page"),annotation_id:r.get("annotation_id"),tags:serde_json::from_str(&r.get::<String,_>("tags_json")).map_err(err)?,created_at:r.get("created_at") })).collect::<Result<Vec<_>>>()?;
  let views = sqlx::query("SELECT json FROM saved_views").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| serde_json::from_str(&r.get::<String,_>(0)).map_err(err)).collect::<Result<Vec<_>>>()?;
  let profile_json:String = sqlx::query_scalar("SELECT value FROM settings WHERE key='profile'").fetch_one(pool).await.map_err(err)?; let profile=serde_json::from_str(&profile_json).map_err(err)?;
  let llm=load_llm_settings(pool).await?; let metadata=online_metadata::load(pool).await?;
  let tasks = sqlx::query("SELECT * FROM tasks ORDER BY CASE status WHEN 'done' THEN 1 ELSE 0 END, due_date IS NULL, due_date, created_at DESC").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| Task { id:r.get("id"),title:r.get("title"),notes:r.get("notes"),due_date:r.get("due_date"),status:r.get("status"),priority:r.get("priority"),paper_id:r.get("paper_id"),created_at:r.get("created_at"),updated_at:r.get("updated_at"),completed_at:r.get("completed_at") }).collect();
  let reading_days = sqlx::query("SELECT day, paper_id, seconds FROM paper_day_reads").fetch_all(pool).await.map_err(err)?.into_iter().map(|r| PaperDayRead { day:r.get("day"), paper_id:r.get("paper_id"), seconds:r.get("seconds") }).collect();
  Ok(LibrarySnapshot { papers,categories,tags,annotations,vocabulary,figures,excerpts,tasks,reading_days,views,profile,llm,metadata,library_path:dir.to_string_lossy().into_owned() })
}

fn default_llm_settings() -> LlmSettings { LlmSettings { base_url:"https://api.openai.com/v1".into(), model:"gpt-4.1-mini".into(), auto_analyze_on_import:true, vision_enabled:true, api_key_saved:false } }
fn llm_key_entry() -> Result<keyring::Entry> { keyring::Entry::new("PaperNest", "llm_api_key").map_err(err) }
async fn load_llm_settings(pool:&SqlitePool)->Result<LlmSettings> {
  let raw:Option<String>=sqlx::query_scalar("SELECT value FROM settings WHERE key='llm_settings'").fetch_optional(pool).await.map_err(err)?;
  let mut settings=raw.as_deref().and_then(|value|serde_json::from_str(value).ok()).unwrap_or_else(default_llm_settings);
  if raw.is_none() { let persisted=serde_json::to_string(&settings).map_err(err)?; sqlx::query("INSERT INTO settings(key,value) VALUES('llm_settings',?)").bind(persisted).execute(pool).await.map_err(err)?; }
  settings.api_key_saved=llm_key_entry().and_then(|entry|entry.get_password().map_err(err)).is_ok();
  Ok(settings)
}

fn row_paper(r: sqlx::sqlite::SqliteRow) -> Result<Paper> { Ok(Paper { id:r.get("id"),title_en:r.get("title_en"),title_zh:r.get("title_zh"),authors:serde_json::from_str(&r.get::<String,_>("authors_json")).map_err(err)?,category_id:r.get("category_id"),tag_ids:serde_json::from_str(&r.get::<String,_>("tag_ids_json")).map_err(err)?,status:r.get("status"),summary:r.get("summary"),abstract_en:r.get("abstract_en"),abstract_zh:r.get("abstract_zh"),venue:r.get("venue"),publication_date:r.get("publication_date"),doi:r.get("doi"),arxiv_id:r.get("arxiv_id"),source_url:r.get("source_url"),pdf_path:r.get("pdf_path"),pdf_sha256:r.get("pdf_sha256"),page_count:r.get("page_count"),has_text_layer:r.get::<Option<i64>,_>("has_text_layer").map(|v|v!=0),favorite:r.get::<i64,_>("favorite")!=0,reading_page:r.get("reading_page"),created_at:r.get("created_at"),updated_at:r.get("updated_at"),deleted_at:r.get("deleted_at"),related_paper_ids:serde_json::from_str(&r.get::<String,_>("related_paper_ids_json")).map_err(err)? }) }

async fn put_paper(pool:&SqlitePool,p:&Paper)->Result<()> { sqlx::query("INSERT INTO papers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title_en=excluded.title_en,title_zh=excluded.title_zh,authors_json=excluded.authors_json,category_id=excluded.category_id,tag_ids_json=excluded.tag_ids_json,status=excluded.status,summary=excluded.summary,abstract_en=excluded.abstract_en,abstract_zh=excluded.abstract_zh,venue=excluded.venue,publication_date=excluded.publication_date,doi=excluded.doi,arxiv_id=excluded.arxiv_id,source_url=excluded.source_url,pdf_path=excluded.pdf_path,pdf_sha256=excluded.pdf_sha256,page_count=excluded.page_count,has_text_layer=excluded.has_text_layer,favorite=excluded.favorite,reading_page=excluded.reading_page,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,related_paper_ids_json=excluded.related_paper_ids_json")
    .bind(&p.id).bind(&p.title_en).bind(&p.title_zh).bind(serde_json::to_string(&p.authors).map_err(err)?).bind(&p.category_id).bind(serde_json::to_string(&p.tag_ids).map_err(err)?).bind(&p.status).bind(&p.summary).bind(&p.abstract_en).bind(&p.abstract_zh).bind(&p.venue).bind(&p.publication_date).bind(&p.doi).bind(&p.arxiv_id).bind(&p.source_url).bind(&p.pdf_path).bind(&p.pdf_sha256).bind(p.page_count).bind(p.has_text_layer.map(i64::from)).bind(i64::from(p.favorite)).bind(p.reading_page).bind(&p.created_at).bind(&p.updated_at).bind(&p.deleted_at).bind(serde_json::to_string(&p.related_paper_ids).map_err(err)?).execute(pool).await.map_err(err)?; rebuild_paper_search(pool,&p.id).await }

async fn rebuild_paper_search(pool:&SqlitePool,id:&str)->Result<()> { let row=sqlx::query("SELECT p.*,COALESCE(c.name,'') category,(SELECT group_concat(t.name,' ') FROM tags t WHERE instr(p.tag_ids_json,t.id)>0) tags,(SELECT group_concat(term_en||' '||meaning_zh||' '||COALESCE(sentence_en,'')||' '||COALESCE(sentence_zh,''),' ') FROM vocabulary WHERE paper_id=p.id) vocab,(SELECT group_concat(source_text||' '||COALESCE(translation_zh,'')||' '||COALESCE(personal_rewrite,''),' ') FROM excerpts WHERE paper_id=p.id) excerpts,(SELECT group_concat(COALESCE(quote,'')||' '||COALESCE(comment,''),' ') FROM annotations WHERE paper_id=p.id) annotations FROM papers p LEFT JOIN categories c ON c.id=p.category_id WHERE p.id=?").bind(id).fetch_one(pool).await.map_err(err)?; let content=format!("{} {} {} {} {} {} {} {} {} {} {} {}",row.get::<String,_>("title_en"),row.get::<Option<String>,_>("title_zh").unwrap_or_default(),row.get::<String,_>("authors_json"),row.get::<Option<String>,_>("summary").unwrap_or_default(),row.get::<Option<String>,_>("abstract_en").unwrap_or_default(),row.get::<Option<String>,_>("abstract_zh").unwrap_or_default(),row.get::<Option<String>,_>("venue").unwrap_or_default(),row.get::<String,_>("category"),row.get::<Option<String>,_>("tags").unwrap_or_default(),row.get::<Option<String>,_>("vocab").unwrap_or_default(),row.get::<Option<String>,_>("excerpts").unwrap_or_default(),row.get::<Option<String>,_>("annotations").unwrap_or_default()); sqlx::query("DELETE FROM paper_search WHERE paper_id=?").bind(id).execute(pool).await.map_err(err)?; sqlx::query("INSERT INTO paper_search(paper_id,content) VALUES(?,?)").bind(id).bind(content).execute(pool).await.map_err(err)?; Ok(()) }

#[tauri::command] async fn save_paper(state:State<'_,AppState>,paper:Paper)->Result<()> { let pool=state.pool.read().await; put_paper(&pool,&paper).await }
#[tauri::command] async fn add_reading_seconds(state:State<'_,AppState>,paper_id:String,day:String,seconds:i64)->Result<i64> {
  if seconds <= 0 { return Ok(0); }
  let pool = state.pool.read().await;
  sqlx::query("INSERT INTO paper_day_reads(day,paper_id,seconds) VALUES(?,?,?) ON CONFLICT(day,paper_id) DO UPDATE SET seconds=seconds+excluded.seconds")
    .bind(&day).bind(&paper_id).bind(seconds).execute(&*pool).await.map_err(err)?;
  let total:i64 = sqlx::query_scalar("SELECT seconds FROM paper_day_reads WHERE day=? AND paper_id=?").bind(&day).bind(&paper_id).fetch_one(&*pool).await.map_err(err)?;
  Ok(total)
}
#[tauri::command] async fn save_annotation(state:State<'_,AppState>,annotation:Annotation)->Result<()> { let p=state.pool.read().await; sqlx::query("INSERT INTO annotations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET page=excluded.page,type=excluded.type,geometry_json=excluded.geometry_json,quote=excluded.quote,comment=excluded.comment,color=excluded.color,updated_at=excluded.updated_at").bind(&annotation.id).bind(&annotation.paper_id).bind(annotation.page).bind(&annotation.r#type).bind(annotation.geometry.to_string()).bind(&annotation.quote).bind(&annotation.comment).bind(&annotation.color).bind(&annotation.created_at).bind(&annotation.updated_at).execute(&*p).await.map_err(err)?; rebuild_paper_search(&p,&annotation.paper_id).await }
#[tauri::command] async fn delete_annotation(state:State<'_,AppState>,id:String)->Result<()> { let p=state.pool.read().await; let paper:Option<String>=sqlx::query_scalar("SELECT paper_id FROM annotations WHERE id=?").bind(&id).fetch_optional(&*p).await.map_err(err)?; sqlx::query("DELETE FROM annotations WHERE id=?").bind(id).execute(&*p).await.map_err(err)?; if let Some(id)=paper { rebuild_paper_search(&p,&id).await?; } Ok(()) }
#[tauri::command] async fn save_vocabulary(state:State<'_,AppState>,entry:VocabularyEntry)->Result<()> { let p=state.pool.read().await; sqlx::query("INSERT INTO vocabulary VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET term_en=excluded.term_en,meaning_zh=excluded.meaning_zh,sentence_en=excluded.sentence_en,sentence_zh=excluded.sentence_zh,page=excluded.page,annotation_id=excluded.annotation_id,note=excluded.note").bind(&entry.id).bind(&entry.paper_id).bind(&entry.term_en).bind(&entry.meaning_zh).bind(&entry.sentence_en).bind(&entry.sentence_zh).bind(entry.page).bind(&entry.annotation_id).bind(&entry.note).execute(&*p).await.map_err(err)?; rebuild_paper_search(&p,&entry.paper_id).await }
#[tauri::command] async fn save_excerpt(state:State<'_,AppState>,entry:WritingExcerpt)->Result<()> { let p=state.pool.read().await; sqlx::query("INSERT INTO excerpts VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET source_text=excluded.source_text,translation_zh=excluded.translation_zh,purpose=excluded.purpose,personal_rewrite=excluded.personal_rewrite,page=excluded.page,annotation_id=excluded.annotation_id,tags_json=excluded.tags_json").bind(&entry.id).bind(&entry.paper_id).bind(&entry.source_text).bind(&entry.translation_zh).bind(&entry.purpose).bind(&entry.personal_rewrite).bind(entry.page).bind(&entry.annotation_id).bind(serde_json::to_string(&entry.tags).map_err(err)?).bind(&entry.created_at).execute(&*p).await.map_err(err)?; rebuild_paper_search(&p,&entry.paper_id).await }
#[tauri::command] async fn delete_vocabulary(state:State<'_,AppState>,id:String)->Result<()> { let p=state.pool.read().await; let paper:Option<String>=sqlx::query_scalar("SELECT paper_id FROM vocabulary WHERE id=?").bind(&id).fetch_optional(&*p).await.map_err(err)?; sqlx::query("DELETE FROM vocabulary WHERE id=?").bind(id).execute(&*p).await.map_err(err)?; if let Some(id)=paper { rebuild_paper_search(&p,&id).await?; } Ok(()) }
#[tauri::command] async fn delete_excerpt(state:State<'_,AppState>,id:String)->Result<()> { let p=state.pool.read().await; let paper:Option<String>=sqlx::query_scalar("SELECT paper_id FROM excerpts WHERE id=?").bind(&id).fetch_optional(&*p).await.map_err(err)?; sqlx::query("DELETE FROM excerpts WHERE id=?").bind(id).execute(&*p).await.map_err(err)?; if let Some(id)=paper { rebuild_paper_search(&p,&id).await?; } Ok(()) }
#[tauri::command] async fn purge_paper(state:State<'_,AppState>,id:String)->Result<()> {
  let pool=state.pool.read().await;
  let row=sqlx::query("SELECT pdf_path, deleted_at FROM papers WHERE id=?").bind(&id).fetch_optional(&*pool).await.map_err(err)?;
  let Some(row)=row else { return Err("论文不存在".into()); };
  let deleted_at:Option<String>=row.get("deleted_at");
  if deleted_at.is_none() { return Err("请先移入回收站再永久删除".into()); }
  let pdf_path:Option<String>=row.get("pdf_path");
  let figure_paths:Vec<String>=sqlx::query_scalar("SELECT image_path FROM figures WHERE paper_id=?").bind(&id).fetch_all(&*pool).await.map_err(err)?;
  sqlx::query("DELETE FROM paper_search WHERE paper_id=?").bind(&id).execute(&*pool).await.map_err(err)?;
  sqlx::query("DELETE FROM pdf_search WHERE paper_id=?").bind(&id).execute(&*pool).await.map_err(err)?;
  sqlx::query("DELETE FROM papers WHERE id=?").bind(&id).execute(&*pool).await.map_err(err)?;
  drop(pool);
  if let Some(path)=pdf_path.filter(|value|!value.is_empty()) {
    let file=state.library_dir.join(path);
    if file.exists() { fs::remove_file(file).map_err(err)?; }
  }
  for path in figure_paths.into_iter().filter(|value|!value.is_empty()) {
    let file=state.library_dir.join(path);
    if file.exists() { fs::remove_file(file).map_err(err)?; }
  }
  Ok(())
}
#[tauri::command] async fn save_figure(state:State<'_,AppState>,mut figure:FrameworkFigure,bytes:Option<Vec<u8>>)->Result<()> { if let Some(bytes)=bytes { let rel=format!("figures/{}.png",figure.id); fs::write(state.library_dir.join(&rel),bytes).map_err(err)?; figure.image_path=rel; } let p=state.pool.read().await; sqlx::query("INSERT INTO figures VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET image_path=excluded.image_path,title=excluded.title,explanation_en=excluded.explanation_en,explanation_zh=excluded.explanation_zh,page=excluded.page,geometry_json=excluded.geometry_json,is_primary=excluded.is_primary").bind(figure.id).bind(figure.paper_id).bind(figure.image_path).bind(figure.title).bind(figure.explanation_en).bind(figure.explanation_zh).bind(figure.page).bind(figure.geometry.map(|v|v.to_string())).bind(i64::from(figure.is_primary)).execute(&*p).await.map_err(err)?; Ok(()) }
#[tauri::command] async fn save_category(state:State<'_,AppState>,category:Category)->Result<()> { sqlx::query("INSERT INTO categories VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color").bind(category.id).bind(category.name).bind(category.color).execute(&*state.pool.read().await).await.map_err(err)?; Ok(()) }
#[tauri::command] async fn save_task(state:State<'_,AppState>,task:Task)->Result<()> { sqlx::query("INSERT INTO tasks VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,notes=excluded.notes,due_date=excluded.due_date,status=excluded.status,priority=excluded.priority,paper_id=excluded.paper_id,updated_at=excluded.updated_at,completed_at=excluded.completed_at").bind(&task.id).bind(&task.title).bind(&task.notes).bind(&task.due_date).bind(&task.status).bind(&task.priority).bind(&task.paper_id).bind(&task.created_at).bind(&task.updated_at).bind(&task.completed_at).execute(&*state.pool.read().await).await.map_err(err)?; Ok(()) }
#[tauri::command] async fn delete_task(state:State<'_,AppState>,id:String)->Result<()> { sqlx::query("DELETE FROM tasks WHERE id=?").bind(id).execute(&*state.pool.read().await).await.map_err(err)?; Ok(()) }
#[tauri::command] async fn save_tag(state:State<'_,AppState>,tag:Tag)->Result<()> { sqlx::query("INSERT INTO tags VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color").bind(tag.id).bind(tag.name).bind(tag.color).execute(&*state.pool.read().await).await.map_err(err)?; Ok(()) }
#[tauri::command] async fn merge_taxonomy(state:State<'_,AppState>,kind:String,source_id:String,target_id:Option<String>)->Result<()> { let p=state.pool.read().await; if kind=="category" { sqlx::query("UPDATE papers SET category_id=? WHERE category_id=?").bind(target_id).bind(&source_id).execute(&*p).await.map_err(err)?; sqlx::query("DELETE FROM categories WHERE id=?").bind(source_id).execute(&*p).await.map_err(err)?; } else { let papers=sqlx::query("SELECT id,tag_ids_json FROM papers").fetch_all(&*p).await.map_err(err)?; for row in papers { let mut ids:Vec<String>=serde_json::from_str(&row.get::<String,_>(1)).map_err(err)?; ids=ids.into_iter().filter_map(|id|if id==source_id{target_id.clone()}else{Some(id)}).collect(); ids.sort();ids.dedup();sqlx::query("UPDATE papers SET tag_ids_json=? WHERE id=?").bind(serde_json::to_string(&ids).map_err(err)?).bind(row.get::<String,_>(0)).execute(&*p).await.map_err(err)?; } sqlx::query("DELETE FROM tags WHERE id=?").bind(source_id).execute(&*p).await.map_err(err)?; } Ok(()) }
#[tauri::command] async fn save_view(state:State<'_,AppState>,view:SavedView)->Result<()> { sqlx::query("INSERT INTO saved_views VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").bind(&view.id).bind(serde_json::to_string(&view).map_err(err)?).execute(&*state.pool.read().await).await.map_err(err)?; Ok(()) }
#[tauri::command] async fn save_profile(state:State<'_,AppState>,profile:Profile)->Result<()> { sqlx::query("INSERT INTO settings VALUES('profile',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(serde_json::to_string(&profile).map_err(err)?).execute(&*state.pool.read().await).await.map_err(err)?; Ok(()) }

#[tauri::command] async fn save_online_metadata_settings(state:State<'_,AppState>,settings:online_metadata::OnlineMetadataSettings)->Result<online_metadata::OnlineMetadataSettings>{ online_metadata::save(&*state.pool.read().await,settings).await }
#[tauri::command] async fn lookup_online_metadata(state:State<'_,AppState>,paper_id:String)->Result<online_metadata::OnlineMetadataLookup>{ online_metadata::lookup(&*state.pool.read().await,&paper_id).await }
#[tauri::command]
async fn save_llm_settings(state:State<'_,AppState>,mut settings:LlmSettings,api_key:Option<String>)->Result<LlmSettings>{
  validate_llm_settings(&settings)?; settings.api_key_saved=false; let payload=serde_json::to_string(&settings).map_err(err)?;
  sqlx::query("INSERT INTO settings(key,value) VALUES('llm_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(payload).execute(&*state.pool.read().await).await.map_err(err)?;
  if let Some(key)=api_key.filter(|value|!value.trim().is_empty()){llm_key_entry()?.set_password(key.trim()).map_err(err)?;}
  load_llm_settings(&*state.pool.read().await).await
}
#[tauri::command]
async fn test_llm_connection(state:State<'_,AppState>)->Result<()> { let settings=load_llm_settings(&*state.pool.read().await).await?; let answer=llm_completion(&settings,"You are a connection test. Return exactly OK.",serde_json::json!("OK")).await?; if answer.trim().is_empty(){return Err("LLM 返回了空响应".into())} Ok(()) }
fn validate_llm_settings(settings:&LlmSettings)->Result<()> { let base=settings.base_url.trim(); if !(base.starts_with("https://")||base.starts_with("http://127.0.0.1")||base.starts_with("http://localhost")){return Err("API 地址只允许 HTTPS 或本机 HTTP 地址".into())} if settings.model.trim().is_empty(){return Err("请填写模型名称".into())} Ok(()) }
#[tauri::command]
async fn translate_text(endpoint:String,text:String,api_key:Option<String>)->Result<String>{
  let endpoint=endpoint.trim();
  let allowed=endpoint.starts_with("https://")||endpoint.starts_with("http://127.0.0.1")||endpoint.starts_with("http://localhost");
  if !allowed{return Err("Translation endpoint must use HTTPS or localhost HTTP.".into());}
  if text.trim().is_empty()||text.chars().count()>10_000{return Err("Translation text must contain 1 to 10000 characters.".into());}
  // LibreTranslate with --load-only en,zh-Hans expects zh-Hans; many clients still send zh.
  let mut request=serde_json::json!({"q":text,"source":"en","target":"zh-Hans","format":"text"});
  if let Some(key)=api_key.filter(|key|!key.trim().is_empty()){request["api_key"]=serde_json::Value::String(key);}
  let client=Client::builder().timeout(Duration::from_secs(20)).build().map_err(err)?;
  let response=client.post(endpoint).json(&request).send().await.map_err(err)?;
  let status=response.status(); let body:serde_json::Value=response.json().await.map_err(err)?;
  if !status.is_success(){return Err(format!("Translation request failed ({status})."));}
  body.get("translatedText").and_then(|value|value.as_str()).map(str::to_owned).filter(|value|!value.trim().is_empty()).ok_or_else(||body.get("error").and_then(|value|value.as_str()).unwrap_or("Translation service returned no text.").to_string())
}
#[tauri::command]
async fn translate_with_llm(state:State<'_,AppState>,text:String,mode:Option<String>,context:Option<String>)->Result<String>{
  let trimmed=text.trim();
  if trimmed.is_empty()||trimmed.chars().count()>10_000{return Err("Translation text must contain 1 to 10000 characters.".into());}
  let settings=load_llm_settings(&*state.pool.read().await).await?;
  let clipped:String=trimmed.chars().take(4_000).collect();
  let context=context.as_deref().map(str::trim).filter(|value|!value.is_empty()).map(|value|value.chars().take(1_200).collect::<String>());
  let is_term=mode.as_deref().map(|value|value.eq_ignore_ascii_case("term")).unwrap_or(false);
  let (system,user)=if is_term {
    (
      "你是计算机科学学术词汇助教。根据英文术语/短语及可选原句上下文，给出适合研究生术语卡片的简体中文释义。\n规则：\n1. 只输出中文释义本身（短语或一两句），不要英文复述、引号、标题或前后缀。\n2. 若有原句，优先采用该语境下的学科义项。\n3. 使用计算机科学论文常用译法；模型名、算法名与通用缩写可保留英文。\n4. 语体正式，勿口语化。",
      match &context {
        Some(sentence) => format!("术语：{clipped}\n原句上下文：{sentence}"),
        None => format!("术语：{clipped}"),
      }
    )
  } else {
    (
      "你是精通简体中文的计算机科学论文翻译引擎。将英文学术文本译为简体中文。\n规则：\n1. 只输出译文，不要解释、标题或前后缀。\n2. 保持正式学术语体；专业术语译法准确且全文一致。\n3. 保留引用标记（如 [1]）、公式、代码标识符；常见模型名与缩写可保留英文。\n4. 若提供了上下文段落，用它消歧，但只翻译「待译文本」。",
      match &context {
        Some(paragraph) => format!("[上下文段落]\n{paragraph}\n\n[待译文本]\n{clipped}"),
        None => clipped,
      }
    )
  };
  let answer=llm_completion(&settings,system,serde_json::Value::String(user)).await?;
  let out=answer.trim().trim_matches('"').trim().to_string();
  if out.is_empty(){return Err("LLM 返回了空译文".into());}
  Ok(out)
}
fn llm_endpoint(base:&str)->String { let base=base.trim().trim_end_matches('/'); if base.ends_with("/chat/completions"){base.into()}else{format!("{base}/chat/completions")} }
async fn llm_completion(settings:&LlmSettings,system:&str,content:serde_json::Value)->Result<String>{
  validate_llm_settings(settings)?; let key=llm_key_entry()?.get_password().map_err(|_|"尚未保存 API Key，请先在设置中配置".to_string())?; if key.trim().is_empty(){return Err("尚未保存 API Key，请先在设置中配置".into())}
  let request=serde_json::json!({"model":settings.model,"temperature":0.1,"messages":[{"role":"system","content":system},{"role":"user","content":content}]});
  let client=Client::builder().timeout(Duration::from_secs(90)).build().map_err(err)?; let response=client.post(llm_endpoint(&settings.base_url)).bearer_auth(key).json(&request).send().await.map_err(err)?;
  let status=response.status(); let value:serde_json::Value=response.json().await.map_err(err)?; if !status.is_success(){return Err(format!("LLM 请求失败（{}）：{}",status,value.get("error").and_then(|v|v.get("message")).and_then(|v|v.as_str()).unwrap_or("请检查地址、模型和 API Key")))}
  let content=value.pointer("/choices/0/message/content").and_then(|v|v.as_str()).map(str::to_owned).or_else(||value.pointer("/choices/0/message/content/0/text").and_then(|v|v.as_str()).map(str::to_owned)).ok_or_else(||"LLM 响应不包含 choices[0].message.content".to_string())?; Ok(content)
}
fn json_from_llm(text:&str)->Result<serde_json::Value>{let trimmed=text.trim().trim_start_matches("```json").trim_start_matches("```").trim_end_matches("```").trim();let start=trimmed.find('{').ok_or_else(||"LLM 未返回 JSON 对象".to_string())?;let end=trimmed.rfind('}').ok_or_else(||"LLM 未返回完整 JSON 对象".to_string())?;serde_json::from_str(&trimmed[start..=end]).map_err(err)}

fn opt_string(value:&serde_json::Value,key:&str)->Option<String>{
  value.get(key).and_then(|item|match item {
    serde_json::Value::String(text) => { let trimmed=text.trim(); if trimmed.is_empty()||trimmed.eq_ignore_ascii_case("null"){None}else{Some(trimmed.to_string())} }
    serde_json::Value::Number(number) => Some(number.to_string()),
    _ => None
  })
}

fn opt_i64(value:&serde_json::Value,key:&str)->Option<i64>{
  value.get(key).and_then(|item|match item {
    serde_json::Value::Number(number) => number.as_i64(),
    serde_json::Value::String(text) => text.trim().parse().ok(),
    _ => None
  })
}

fn parse_authors(value:&serde_json::Value)->Option<Vec<String>>{
  let authors=value.get("authors")?;
  if let Some(list)=authors.as_array(){
    let names:Vec<String>=list.iter().filter_map(|item|item.as_str().map(str::trim).filter(|name|!name.is_empty()).map(str::to_string)).collect();
    return if names.is_empty(){None}else{Some(names)};
  }
  authors.as_str().map(|text|{
    text.split(|ch|ch==','||ch==';').map(str::trim).filter(|name|!name.is_empty()).map(str::to_string).collect::<Vec<_>>()
  }).filter(|names|!names.is_empty())
}

fn parse_vocabulary(value:&serde_json::Value)->Option<Vec<LlmVocabularySuggestion>>{
  let list=value.get("vocabulary")?.as_array()?;
  let items:Vec<LlmVocabularySuggestion>=list.iter().filter_map(|item|{
    let term_en=opt_string(item,"termEn")?;
    let meaning_zh=opt_string(item,"meaningZh")?;
    Some(LlmVocabularySuggestion{
      term_en, meaning_zh,
      sentence_en:opt_string(item,"sentenceEn"),
      sentence_zh:opt_string(item,"sentenceZh"),
      page:opt_i64(item,"page"),
    })
  }).collect();
  if items.is_empty(){None}else{Some(items)}
}

fn parse_llm_analysis(value:serde_json::Value)->Result<LlmAnalysis>{
  Ok(LlmAnalysis{
    title_en:opt_string(&value,"titleEn"),
    title_zh:opt_string(&value,"titleZh"),
    authors:parse_authors(&value),
    abstract_en:opt_string(&value,"abstractEn"),
    abstract_zh:opt_string(&value,"abstractZh"),
    summary:opt_string(&value,"summary"),
    venue:opt_string(&value,"venue"),
    publication_date:opt_string(&value,"publicationDate"),
    doi:opt_string(&value,"doi"),
    source_url:opt_string(&value,"sourceUrl"),
    framework_page:opt_i64(&value,"frameworkPage"),
    framework_title:opt_string(&value,"frameworkTitle"),
    framework_explanation_en:opt_string(&value,"frameworkExplanationEn"),
    framework_explanation_zh:opt_string(&value,"frameworkExplanationZh"),
    vocabulary:parse_vocabulary(&value),
  })
}

#[tauri::command]
async fn analyze_paper_with_llm(state:State<'_,AppState>,paper_id:String,input:LlmAnalysisInput)->Result<LlmAnalysis>{
  let settings=load_llm_settings(&*state.pool.read().await).await?; let text=input.text.chars().take(70_000).collect::<String>(); if text.trim().len()<80{return Err("PDF 没有足够的可提取文本，无法自动分析".into())}
  let mut content=vec![serde_json::json!({"type":"text","text":format!("请分析以下论文 PDF 提取文本。\n\n{}",text)})];
  if settings.vision_enabled { for image in input.candidate_images.into_iter().take(3){content.push(serde_json::json!({"type":"text","text":format!("候选模型图页：第 {} 页",image.page)}));content.push(serde_json::json!({"type":"image_url","image_url":{"url":image.data_url}}));} }
  let system="你是严谨的计算机科学论文助教。仅依据给定 PDF 文本和候选页面，不要编造。返回一个 JSON 对象，字段为 titleEn,titleZh,authors,abstractEn,abstractZh,summary,venue,publicationDate,doi,sourceUrl,frameworkPage,frameworkTitle,frameworkExplanationEn,frameworkExplanationZh,vocabulary。只要文本中能读到 Abstract 或足够正文：summary 必须是非空的简体中文一句话；vocabulary 必须至少 5 项（每项含 termEn,meaningZh,sentenceEn,sentenceZh,page，page 用数字）。abstractZh、titleZh、frameworkExplanationZh、vocabulary 的 meaningZh/sentenceZh 须按计算机科学论文学术语体翻译或释义（术语准确、正式、不口语化；模型名与常用缩写可保留英文）。frameworkPage 仅在候选页面确有方法框架图时返回页码。其它找不到的字段返回 null。不要省略 summary 与 vocabulary。";
  let value=json_from_llm(&llm_completion(&settings,system,serde_json::Value::Array(content)).await?)?; let analysis=parse_llm_analysis(value)?; let _=paper_id; Ok(analysis)
}
fn normalized_title(value:&str)->String{value.to_lowercase().chars().filter(|c|c.is_alphanumeric()).collect()}
#[tauri::command]
async fn find_duplicate_candidates(state:State<'_,AppState>,paper_id:String)->Result<Vec<DuplicateCandidate>>{let p=state.pool.read().await;let current=row_paper(sqlx::query("SELECT * FROM papers WHERE id=?").bind(&paper_id).fetch_one(&*p).await.map_err(err)?)?;let mut out=Vec::new();if let Some(doi)=current.doi.as_deref().filter(|v|!v.trim().is_empty()){for row in sqlx::query("SELECT id,COALESCE(title_zh,title_en) title FROM papers WHERE id<>? AND lower(doi)=lower(?) AND deleted_at IS NULL").bind(&paper_id).bind(doi).fetch_all(&*p).await.map_err(err)?{out.push(DuplicateCandidate{paper_id:row.get(0),title:row.get(1),reason:"DOI 相同".into()});}}
let title=normalized_title(&current.title_en);if title.len()>12{for row in sqlx::query("SELECT id,title_en,title_zh FROM papers WHERE id<>? AND deleted_at IS NULL").bind(&paper_id).fetch_all(&*p).await.map_err(err)?{let other: String=row.get("title_en");if normalized_title(&other)==title{out.push(DuplicateCandidate{paper_id:row.get("id"),title:row.get::<Option<String>,_>("title_zh").unwrap_or(other),reason:"规范化英文标题相同".into()});}}}out.sort_by(|a,b|a.paper_id.cmp(&b.paper_id));out.dedup_by(|a,b|a.paper_id==b.paper_id);Ok(out)}

#[tauri::command]
async fn import_pdfs(state:State<'_,AppState>,paths:Vec<String>)->Result<Vec<ImportedPaper>> {
  let p=state.pool.read().await; let mut result=Vec::new();
  for source in paths {
    let source=PathBuf::from(source); if source.extension().and_then(|v|v.to_str()).map(|v|v.eq_ignore_ascii_case("pdf"))!=Some(true){continue;}
    let id=Uuid::new_v4().to_string(); let rel=format!("pdf/originals/{id}.pdf");
    let bytes=fs::read(&source).map_err(err)?; fs::write(state.library_dir.join(&rel),&bytes).map_err(err)?;
    let digest=format!("{:x}",Sha256::digest(&bytes));
    let title=source.file_stem().and_then(|v|v.to_str()).unwrap_or("Untitled paper").replace('_'," "); let now=Utc::now().to_rfc3339();
    let paper=Paper{id,title_en:title,title_zh:None,authors:vec![],category_id:None,tag_ids:vec![],status:"unread".into(),summary:None,abstract_en:None,abstract_zh:None,venue:None,publication_date:None,doi:None,arxiv_id:None,source_url:None,pdf_path:Some(rel),pdf_sha256:Some(digest),page_count:None,has_text_layer:None,favorite:false,reading_page:Some(1),created_at:now.clone(),updated_at:now,deleted_at:None,related_paper_ids:vec![]};
    put_paper(&p,&paper).await?; result.push(ImportedPaper{paper,is_new:true});
  }
  Ok(result)
}

#[tauri::command]
async fn import_citation_files(state:State<'_,AppState>,paths:Vec<String>)->Result<Vec<Paper>> { let p=state.pool.read().await; let mut out=Vec::new(); for path in paths { let text=fs::read_to_string(&path).map_err(err)?; let ext=Path::new(&path).extension().and_then(|e|e.to_str()).unwrap_or("").to_lowercase(); let items=if ext=="ris"{parse_ris(&text)}else{parse_bibtex(&text)}; for mut paper in items { if paper.id.is_empty(){paper.id=Uuid::new_v4().to_string();} put_paper(&p,&paper).await?;out.push(paper); } } Ok(out) }

fn blank_paper(title:String)->Paper { let now=Utc::now().to_rfc3339(); Paper{id:Uuid::new_v4().to_string(),title_en:title,title_zh:None,authors:vec![],category_id:None,tag_ids:vec![],status:"unread".into(),summary:None,abstract_en:None,abstract_zh:None,venue:None,publication_date:None,doi:None,arxiv_id:None,source_url:None,pdf_path:None,pdf_sha256:None,page_count:None,has_text_layer:None,favorite:false,reading_page:None,created_at:now.clone(),updated_at:now,deleted_at:None,related_paper_ids:vec![]} }
fn parse_ris(text:&str)->Vec<Paper>{ let mut out=vec![];let mut current=blank_paper("Untitled".into());for line in text.lines(){let (key,value)=line.split_once("  - ").unwrap_or(("", ""));match key.trim(){"TY"=>current=blank_paper("Untitled".into()),"TI"|"T1"=>current.title_en=value.trim().into(),"AU"=>current.authors.push(Author{id:Uuid::new_v4().to_string(),name:value.trim().into()}),"JO"|"JF"|"T2"=>current.venue=Some(value.trim().into()),"PY"|"Y1"=>current.publication_date=Some(value.trim().chars().take(10).collect()),"DO"=>current.doi=Some(value.trim().into()),"UR"=>current.source_url=Some(value.trim().into()),"AB"=>current.abstract_en=Some(value.trim().into()),"ER"=>out.push(current.clone()),_=>{}}} out }
fn parse_bibtex(text:&str)->Vec<Paper>{ let mut out=vec![];for entry in text.split('@').skip(1){let mut paper=blank_paper(field(entry,"title").unwrap_or_else(||"Untitled".into()));if let Some(authors)=field(entry,"author"){paper.authors=authors.split(" and ").map(|name|Author{id:Uuid::new_v4().to_string(),name:name.trim().trim_matches('{').trim_matches('}').into()}).collect();}paper.venue=field(entry,"booktitle").or_else(||field(entry,"journal"));paper.publication_date=field(entry,"year");paper.doi=field(entry,"doi");paper.source_url=field(entry,"url");paper.abstract_en=field(entry,"abstract");out.push(paper);}out }
fn field(entry:&str,name:&str)->Option<String>{ let lower=entry.to_lowercase();let start=lower.find(&format!("{name}"))?;let rest=&entry[start+name.len()..];let eq=rest.find('=')?;let value=rest[eq+1..].trim_start();let open=value.chars().next()?;let close=if open=='{'{'}'}else if open=='\"'{'\"'}else{','};let body=&value[1..];let end=body.find(close).or_else(||body.find(','))?;Some(body[..end].trim().replace(['\n','\r']," "))}

#[tauri::command]
fn open_external_url(url: String) -> Result<()> {
  let trimmed = url.trim();
  if trimmed.is_empty() { return Err("链接为空".into()); }
  let href = if trimmed.starts_with("https://") || trimmed.starts_with("http://") {
    trimmed.to_string()
  } else if trimmed.starts_with("doi.org/") {
    format!("https://{trimmed}")
  } else if trimmed.starts_with("10.") {
    format!("https://doi.org/{trimmed}")
  } else {
    return Err("只允许打开 http/https 原文链接".into());
  };
  open::that(&href).map_err(err)
}
#[tauri::command] fn read_managed_file(state:State<'_,AppState>,path:String)->Result<Vec<u8>> { let requested=state.library_dir.join(path); let canonical=requested.canonicalize().map_err(err)?; let root=state.library_dir.canonicalize().map_err(err)?; if !canonical.starts_with(root){return Err("拒绝读取资料库之外的文件".into());} fs::read(canonical).map_err(err) }
#[tauri::command] fn write_export_file(path:String,bytes:Vec<u8>)->Result<()> { let target=PathBuf::from(path); let temp=target.with_extension("papernest.tmp"); fs::write(&temp,bytes).map_err(err)?; fs::rename(temp,target).map_err(err) }
#[tauri::command] async fn index_pdf_pages(state:State<'_,AppState>,paper_id:String,pages:Vec<PageText>)->Result<()> { let mut tx=state.pool.read().await.begin().await.map_err(err)?; sqlx::query("DELETE FROM pdf_pages WHERE paper_id=?").bind(&paper_id).execute(&mut *tx).await.map_err(err)?;sqlx::query("DELETE FROM pdf_search WHERE paper_id=?").bind(&paper_id).execute(&mut *tx).await.map_err(err)?;for page in pages{sqlx::query("INSERT INTO pdf_pages VALUES(?,?,?)").bind(&paper_id).bind(page.page).bind(&page.text).execute(&mut *tx).await.map_err(err)?;sqlx::query("INSERT INTO pdf_search VALUES(?,?,?)").bind(&paper_id).bind(page.page).bind(page.text).execute(&mut *tx).await.map_err(err)?;}tx.commit().await.map_err(err) }
#[tauri::command] async fn indexed_pdf_pages(state:State<'_,AppState>,paper_id:String)->Result<Vec<PageText>> { let pool=state.pool.read().await; sqlx::query("SELECT page,content FROM pdf_pages WHERE paper_id=? ORDER BY page").bind(paper_id).fetch_all(&*pool).await.map_err(err).map(|rows|rows.into_iter().map(|row|PageText{page:row.get("page"),text:row.get("content")}).collect()) }
#[tauri::command] async fn ocr_page_image(state:State<'_,AppState>,paper_id:String,page:i64,png:Vec<u8>)->Result<String> { if png.is_empty()||png.len()>20*1024*1024{return Err("OCR 图片为空或超过 20 MB".into());} let pool=state.pool.read().await; let exists:Option<String>=sqlx::query_scalar("SELECT id FROM papers WHERE id=? AND deleted_at IS NULL").bind(&paper_id).fetch_optional(&*pool).await.map_err(err)?; drop(pool); if exists.is_none(){return Err("论文不存在或已移入回收站".into());} let temp_dir=state.library_dir.join(".ocr"); fs::create_dir_all(&temp_dir).map_err(err)?; let image=temp_dir.join(format!("{}-{}.png",Uuid::new_v4(),page)); fs::write(&image,png).map_err(err)?; let executable=tesseract_executable(); let ocr_image=image.clone(); let command_result=tokio::task::spawn_blocking(move||Command::new(executable).arg(&ocr_image).arg("stdout").arg("-l").arg("eng").output()).await.map_err(err)?; let _=fs::remove_file(&image); let output=command_result.map_err(err)?; if !output.status.success(){return Err(format!("本地 OCR 失败：{}",String::from_utf8_lossy(&output.stderr).trim()));} Ok(String::from_utf8(output.stdout).map_err(err)?.trim().to_string()) }
#[tauri::command] async fn prepare_library_relocation(state:State<'_,AppState>,target_parent:String)->Result<String> { let parent=PathBuf::from(target_parent); if !parent.is_absolute(){return Err("请选择一个本地文件夹".into());} let target=parent.join("PaperNestLibrary"); if target==state.library_dir||target.starts_with(&state.library_dir){return Err("目标不能是当前资料库或其子目录".into());} if target.exists()&&fs::read_dir(&target).map_err(err)?.next().is_some(){return Err("目标文件夹中的 PaperNestLibrary 已有内容，请选择其它位置".into());} sqlx::query("PRAGMA wal_checkpoint(FULL)").execute(&*state.pool.read().await).await.map_err(err)?; fs::create_dir_all(&target).map_err(err)?; copy_library(&state.library_dir,&target)?; if !target.join("library.db").exists(){return Err("复制资料库失败，未找到 library.db".into());} let temp=state.location_config.with_extension("json.tmp"); let location=LibraryLocation{library_path:target.to_string_lossy().into_owned()}; fs::write(&temp,serde_json::to_vec_pretty(&location).map_err(err)?).map_err(err)?; fs::rename(temp,&state.location_config).map_err(err)?; Ok(target.to_string_lossy().into_owned()) }
#[tauri::command] async fn search_library(state:State<'_,AppState>,query:String)->Result<Vec<SearchHit>> { if query.trim().is_empty(){return Ok(vec![]);}let p=state.pool.read().await;let phrase=format!("\"{}\"",query.replace('"',"\""));let mut hits=vec![];for r in sqlx::query("SELECT p.id,COALESCE(p.title_zh,p.title_en),substr(s.content,1,220),bm25(paper_search) score FROM paper_search s JOIN papers p ON p.id=s.paper_id WHERE paper_search MATCH ? AND p.deleted_at IS NULL ORDER BY score LIMIT 30").bind(&phrase).fetch_all(&*p).await.unwrap_or_default(){hits.push(SearchHit{kind:"paper".into(),paper_id:r.get(0),title:r.get(1),snippet:r.get(2),page:None,score:r.get::<f64,_>(3)});}for r in sqlx::query("SELECT p.id,COALESCE(p.title_zh,p.title_en),substr(s.text,1,220),s.page,bm25(pdf_search) score FROM pdf_search s JOIN papers p ON p.id=s.paper_id WHERE pdf_search MATCH ? AND p.deleted_at IS NULL ORDER BY score LIMIT 30").bind(&phrase).fetch_all(&*p).await.unwrap_or_default(){hits.push(SearchHit{kind:"pdf".into(),paper_id:r.get(0),title:r.get(1),snippet:r.get(2),page:Some(r.get(3)),score:r.get::<f64,_>(4)});}Ok(hits) }

#[tauri::command]
async fn create_backup(state:State<'_,AppState>)->Result<String>{ sqlx::query("PRAGMA wal_checkpoint(FULL)").execute(&*state.pool.read().await).await.map_err(err)?;let output=state.library_dir.join("backups").join(format!("papernest-{}.zip",Utc::now().format("%Y%m%d-%H%M%S")));let file=fs::File::create(&output).map_err(err)?;let mut zip=ZipWriter::new(file);let options=SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);for entry in WalkDir::new(&state.library_dir).into_iter().filter_map(|e|e.ok()){let path=entry.path();if path==output||path.starts_with(state.library_dir.join("backups"))||!path.is_file(){continue;}let name=path.strip_prefix(&state.library_dir).map_err(err)?.to_string_lossy().replace('\\',"/");zip.start_file(name,options).map_err(err)?;let mut source=fs::File::open(path).map_err(err)?;let mut buf=Vec::new();source.read_to_end(&mut buf).map_err(err)?;zip.write_all(&buf).map_err(err)?;}zip.finish().map_err(err)?;Ok(output.to_string_lossy().into_owned()) }

#[tauri::command]
async fn restore_backup(state:State<'_,AppState>,path:String)->Result<()> { let temp=state.library_dir.join(format!("restore-{}",Uuid::new_v4()));fs::create_dir_all(&temp).map_err(err)?;let mut archive=ZipArchive::new(fs::File::open(path).map_err(err)?).map_err(err)?;for i in 0..archive.len(){let mut item=archive.by_index(i).map_err(err)?;let Some(safe)=item.enclosed_name().map(|p|p.to_owned()) else{return Err("备份包含不安全路径".into())};let out=temp.join(safe);if item.is_dir(){fs::create_dir_all(&out).map_err(err)?;}else{if let Some(parent)=out.parent(){fs::create_dir_all(parent).map_err(err)?;}let mut target=fs::File::create(&out).map_err(err)?;std::io::copy(&mut item,&mut target).map_err(err)?;}}if !temp.join("manifest.json").exists()||!temp.join("library.db").exists(){return Err("不是有效的 PaperNest 备份".into());}{let pool=state.pool.read().await.clone();pool.close().await;}for entry in WalkDir::new(&temp).into_iter().filter_map(|e|e.ok()).filter(|e|e.path().is_file()){let rel=entry.path().strip_prefix(&temp).map_err(err)?;let target=state.library_dir.join(rel);if let Some(parent)=target.parent(){fs::create_dir_all(parent).map_err(err)?;}fs::copy(entry.path(),target).map_err(err)?;}fs::remove_dir_all(&temp).map_err(err)?;let new_pool=open_pool(&state.library_dir).await?;*state.pool.write().await=new_pool;Ok(()) }

fn err<E:std::fmt::Display>(e:E)->String{e.to_string()}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default().plugin(tauri_plugin_dialog::init()).setup(|app| { let (dir,location_config)=resolve_library_dir(app).map_err(std::io::Error::other)?;let pool=tauri::async_runtime::block_on(open_pool(&dir)).map_err(std::io::Error::other)?;app.manage(AppState{library_dir:dir,location_config,pool:RwLock::new(pool)});Ok(()) })
    .invoke_handler(tauri::generate_handler![initialize_library,save_paper,add_reading_seconds,save_annotation,delete_annotation,save_vocabulary,delete_vocabulary,save_excerpt,delete_excerpt,purge_paper,save_task,delete_task,save_figure,save_category,save_tag,merge_taxonomy,save_view,save_profile,save_llm_settings,save_online_metadata_settings,lookup_online_metadata,test_llm_connection,translate_text,translate_with_llm,analyze_paper_with_llm,find_duplicate_candidates,import_pdfs,import_citation_files,read_managed_file,write_export_file,index_pdf_pages,indexed_pdf_pages,ocr_page_image,prepare_library_relocation,search_library,create_backup,restore_backup,open_external_url])
    .run(tauri::generate_context!()).expect("failed to run PaperNest");
}
