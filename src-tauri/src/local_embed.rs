//! 本地学术向向量：BAAI/bge-small-en-v1.5（ONNX via fastembed）。
//! SciBERT（allenai/scibert_scivocab_uncased）是 MLM，不是句子 embedding 模型，
//! 不能填进 OpenAI /embeddings，也不适合做兴趣短语语义匹配。

use super::{err, Result};
use fastembed::{EmbeddingModel, TextEmbedding, TextInitOptions};
use reqwest::Client;
use serde::Serialize;
use std::{
  env, fs,
  io::{copy, Write},
  path::{Path, PathBuf},
  sync::Mutex,
  time::Duration,
};
use zip::ZipArchive;

pub const LOCAL_EMBED_MODEL_ID: &str = "local:bge-small-en-v1.5";
pub const LOCAL_EMBED_DISPLAY: &str = "BAAI/bge-small-en-v1.5";
pub const LOCAL_EMBED_HF_URL: &str = "https://huggingface.co/BAAI/bge-small-en-v1.5";

/// Microsoft ONNX Runtime Windows x64（与 ort load-dynamic 配套，首次启用时下载）。
const ORT_ZIP_URL: &str = "https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-win-x64-1.22.0.zip";

static LOCAL_MODEL: Mutex<Option<TextEmbedding>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalEmbedStatus {
  pub model_id: String,
  pub display_name: String,
  pub hf_url: String,
  pub cache_dir: String,
  pub installed: bool,
  pub ready: bool,
  pub approx_size_hint: String,
  pub note: String,
}

pub fn is_local_embed_model(model: &str) -> bool {
  let trimmed = model.trim();
  trimmed == LOCAL_EMBED_MODEL_ID || trimmed.eq_ignore_ascii_case("local:bge-small")
}

pub fn models_root() -> Result<PathBuf> {
  let exe = env::current_exe().map_err(err)?;
  let parent = exe.parent().ok_or_else(|| "无法定位软件安装目录".to_string())?;
  Ok(parent.join("models"))
}

pub fn local_embed_cache_dir() -> Result<PathBuf> {
  Ok(models_root()?.join("bge-small-en-v1.5"))
}

fn onnx_runtime_dll_path() -> Result<PathBuf> {
  Ok(models_root()?.join("onnxruntime").join("onnxruntime.dll"))
}

fn dir_has_onnx(dir: &Path) -> bool {
  if !dir.exists() {
    return false;
  }
  WalkDirLite::new(dir).any(|path| path.extension().and_then(|e| e.to_str()) == Some("onnx"))
}

struct WalkDirLite {
  stack: Vec<PathBuf>,
}

impl WalkDirLite {
  fn new(root: &Path) -> Self {
    Self {
      stack: vec![root.to_path_buf()],
    }
  }
}

impl Iterator for WalkDirLite {
  type Item = PathBuf;
  fn next(&mut self) -> Option<Self::Item> {
    while let Some(path) = self.stack.pop() {
      if path.is_dir() {
        if let Ok(entries) = fs::read_dir(&path) {
          for entry in entries.flatten() {
            self.stack.push(entry.path());
          }
        }
        continue;
      }
      return Some(path);
    }
    None
  }
}

pub fn local_embed_status() -> Result<LocalEmbedStatus> {
  let cache_dir = local_embed_cache_dir()?;
  let ort_ok = onnx_runtime_dll_path().map(|p| p.exists()).unwrap_or(false);
  let model_ok = dir_has_onnx(&cache_dir);
  let installed = model_ok && ort_ok;
  let ready = LOCAL_MODEL.lock().map_err(err)?.is_some() || installed;
  Ok(LocalEmbedStatus {
    model_id: LOCAL_EMBED_MODEL_ID.into(),
    display_name: LOCAL_EMBED_DISPLAY.into(),
    hf_url: LOCAL_EMBED_HF_URL.into(),
    cache_dir: cache_dir.to_string_lossy().into_owned(),
    installed,
    ready,
    approx_size_hint: "BGE ≈130MB + ONNX Runtime ≈50MB".into(),
    note: "SciBERT 是科学文本语言模型，不是句子向量模型；本地推荐 BGE-small。运行时还需 onnxruntime.dll（首次启用自动下载到 models/onnxruntime/）。".into(),
  })
}

fn ensure_onnxruntime_dll() -> Result<PathBuf> {
  let dll = onnx_runtime_dll_path()?;
  if dll.exists() {
    env::set_var("ORT_DYLIB_PATH", &dll);
    return Ok(dll);
  }
  let dir = dll.parent().ok_or_else(|| "无效 ONNX Runtime 路径".to_string())?;
  fs::create_dir_all(dir).map_err(err)?;
  let zip_path = dir.join("onnxruntime-win-x64.zip");
  let bytes = tauri::async_runtime::block_on(async {
    let client = Client::builder()
      .timeout(Duration::from_secs(300))
      .build()
      .map_err(err)?;
    let response = client.get(ORT_ZIP_URL).send().await.map_err(err)?;
    let status = response.status();
    if !status.is_success() {
      return Err(format!("下载 ONNX Runtime 失败（{status}）"));
    }
    response.bytes().await.map_err(err)
  })?;
  {
    let mut file = fs::File::create(&zip_path).map_err(err)?;
    file.write_all(&bytes).map_err(err)?;
  }
  let file = fs::File::open(&zip_path).map_err(err)?;
  let mut archive = ZipArchive::new(file).map_err(err)?;
  let mut found = false;
  for index in 0..archive.len() {
    let mut entry = archive.by_index(index).map_err(err)?;
    let name = entry.name().replace('\\', "/");
    if !name.ends_with("onnxruntime.dll") {
      continue;
    }
    let mut out = fs::File::create(&dll).map_err(err)?;
    copy(&mut entry, &mut out).map_err(err)?;
    found = true;
    break;
  }
  let _ = fs::remove_file(&zip_path);
  if !found {
    return Err("ONNX Runtime 压缩包中未找到 onnxruntime.dll".into());
  }
  env::set_var("ORT_DYLIB_PATH", &dll);
  Ok(dll)
}

fn load_model_blocking(download_if_missing: bool) -> Result<()> {
  ensure_onnxruntime_dll()?;
  let cache_dir = local_embed_cache_dir()?;
  fs::create_dir_all(&cache_dir).map_err(err)?;
  if !download_if_missing && !dir_has_onnx(&cache_dir) {
    return Err(format!(
      "本地向量模型尚未安装。请在设置中点击「下载并启用本地向量模型」。目录：{}",
      cache_dir.display()
    ));
  }
  let model = TextEmbedding::try_new(
    TextInitOptions::new(EmbeddingModel::BGESmallENV15)
      .with_cache_dir(cache_dir)
      .with_show_download_progress(true),
  )
  .map_err(|e| format!("加载本地向量模型失败：{e}"))?;
  *LOCAL_MODEL.lock().map_err(err)? = Some(model);
  Ok(())
}

pub fn ensure_local_embed_model_blocking() -> Result<LocalEmbedStatus> {
  load_model_blocking(true)?;
  local_embed_status()
}

pub fn embed_texts_blocking(inputs: Vec<String>) -> Result<Vec<Vec<f32>>> {
  if inputs.is_empty() {
    return Ok(vec![]);
  }
  {
    let guard = LOCAL_MODEL.lock().map_err(err)?;
    if guard.is_none() {
      drop(guard);
      load_model_blocking(false)?;
    }
  }
  let mut guard = LOCAL_MODEL.lock().map_err(err)?;
  let model = guard.as_mut().ok_or_else(|| "本地向量模型未就绪".to_string())?;
  let embeddings = model
    .embed(inputs, None)
    .map_err(|e| format!("本地向量计算失败：{e}"))?;
  Ok(embeddings)
}

#[tauri::command]
pub async fn local_embedding_status() -> Result<LocalEmbedStatus> {
  tokio::task::spawn_blocking(local_embed_status)
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ensure_local_embedding_model() -> Result<LocalEmbedStatus> {
  tokio::task::spawn_blocking(ensure_local_embed_model_blocking)
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn enable_local_embedding_model(state: tauri::State<'_, super::AppState>) -> Result<super::LlmSettings> {
  let status = ensure_local_embedding_model().await?;
  if !status.installed && !status.ready {
    return Err("本地向量模型安装未完成".into());
  }
  let pool = state.pool.read().await;
  let mut settings = super::load_llm_settings(&pool).await?;
  settings.embedding_model = Some(LOCAL_EMBED_MODEL_ID.into());
  let payload = serde_json::to_string(&settings).map_err(err)?;
  sqlx::query("INSERT INTO settings(key,value) VALUES('llm_settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .bind(payload)
    .execute(&*pool)
    .await
    .map_err(err)?;
  drop(pool);
  super::load_llm_settings(&*state.pool.read().await).await
}
