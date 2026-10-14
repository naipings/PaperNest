//! Skill 库：本地 / GitHub 导入，按上游仓库检查与更新，删除；论文精读追问时按需读取 skill 文本。
//! 文件位于 `<资料库>/skills/<目录名>/`，元数据位于 `skills` 表。

use super::*;
use sha1::{Digest, Sha1};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::sync::OnceLock;

const SCRIPT_EXTS: &[&str] = &["py", "sh", "js", "mjs", "cjs", "ts", "ps1", "bat", "cmd", "rb", "pl"];
const TEXT_EXTS: &[&str] = &["md", "markdown", "yaml", "yml", "json", "txt"];
pub(crate) const SKILL_READ_CHARS: usize = 40_000;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillEntry {
  pub dir: String,
  pub name: String,
  pub description: String,
  pub kind: String,
  pub license: Option<String>,
  pub has_scripts: bool,
  pub enabled: bool,
  pub requires: Vec<String>,
  pub source_repo: Option<String>,
  pub source_path: Option<String>,
  pub status: String,
  pub checked_at: Option<String>,
  pub installed_at: String,
  pub updated_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCandidate {
  pub dir: String,
  pub name: String,
  pub description: String,
  pub has_scripts: bool,
  pub requires: Vec<String>,
  pub installed: bool,
  pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalScan {
  pub root: String,
  pub skills: Vec<SkillCandidate>,
  pub repos: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubSkill {
  pub path: String,
  pub dir: String,
  pub has_scripts: bool,
  pub installed: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubScan {
  pub repo: String,
  pub skills: Vec<GithubSkill>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkReport {
  pub linked: Vec<String>,
  pub differs: Vec<String>,
  pub unmatched: Vec<String>,
}

#[derive(Serialize, Default, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkillDiff {
  pub added: Vec<String>,
  pub removed: Vec<String>,
  pub modified: Vec<String>,
}

impl SkillDiff {
  fn is_empty(&self) -> bool {
    self.added.is_empty() && self.removed.is_empty() && self.modified.is_empty()
  }
}

#[derive(Debug)]
struct Frontmatter {
  name: String,
  description: String,
  license: Option<String>,
}

struct Inspected {
  name: String,
  description: String,
  kind: &'static str,
  license: Option<String>,
  has_scripts: bool,
  references: BTreeSet<String>,
}

struct Source<'a> {
  repo: &'a str,
  path: &'a str,
  sha: &'a str,
}

fn parse_frontmatter(text: &str) -> Result<Frontmatter> {
  let text = text.trim_start_matches('\u{feff}');
  let rest = text
    .strip_prefix("---")
    .and_then(|r| r.strip_prefix('\n').or_else(|| r.strip_prefix("\r\n")))
    .ok_or("SKILL.md 缺少 YAML frontmatter")?;
  let end = rest.find("\n---").ok_or("SKILL.md 的 frontmatter 缺少结束行 ---")?;
  let value: serde_yaml::Value =
    serde_yaml::from_str(&rest[..end]).map_err(|e| format!("frontmatter 解析失败：{e}"))?;
  let field = |key: &str| {
    value.get(key).and_then(|v| v.as_str()).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
  };
  Ok(Frontmatter {
    name: field("name").ok_or("frontmatter 缺少 name")?,
    description: field("description").ok_or("frontmatter 缺少 description")?,
    license: field("license"),
  })
}

fn ext_of(path: &str) -> String {
  Path::new(path).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn is_script(path: &str) -> bool {
  SCRIPT_EXTS.contains(&ext_of(path).as_str())
}

fn list_files(dir: &Path) -> Result<Vec<String>> {
  let mut files = Vec::new();
  for entry in WalkDir::new(dir) {
    let entry = entry.map_err(err)?;
    if entry.file_type().is_file() {
      files.push(entry.path().strip_prefix(dir).map_err(err)?.to_string_lossy().replace('\\', "/"));
    }
  }
  files.sort();
  Ok(files)
}

fn reference_regex() -> &'static regex::Regex {
  static RE: OnceLock<regex::Regex> = OnceLock::new();
  RE.get_or_init(|| regex::Regex::new(r"((?:\.\./)+)([A-Za-z0-9_][A-Za-z0-9_.-]*)/").expect("valid regex"))
}

/// `file_rel` 相对 skill 所在的上级目录（形如 `ccf-paper-reviewer/references/x.md`）；
/// 返回 `../` 引用解析后恰好落在同级的其他目录名。
fn sibling_references(text: &str, file_rel: &str) -> BTreeSet<String> {
  let parent: Vec<&str> = file_rel.split('/').collect::<Vec<_>>().split_last().map(|(_, p)| p.to_vec()).unwrap_or_default();
  let mut found = BTreeSet::new();
  for caps in reference_regex().captures_iter(text) {
    let ups = caps[1].len() / 3;
    let name = &caps[2];
    if ups == parent.len() && name != parent[0] {
      found.insert(name.to_string());
    }
  }
  found
}

fn skill_references(root: &Path, dir: &str) -> Result<BTreeSet<String>> {
  let mut found = BTreeSet::new();
  for rel in list_files(&root.join(dir))? {
    if !TEXT_EXTS.contains(&ext_of(&rel).as_str()) {
      continue;
    }
    let bytes = fs::read(root.join(dir).join(&rel)).map_err(err)?;
    found.extend(sibling_references(&String::from_utf8_lossy(&bytes), &format!("{dir}/{rel}")));
  }
  Ok(found)
}

fn inspect(root: &Path, dir: &str) -> Result<Inspected> {
  let path = root.join(dir);
  let has_scripts = list_files(&path)?.iter().any(|f| is_script(f));
  let skill_md = path.join("SKILL.md");
  let (name, description, kind, license) = if skill_md.is_file() {
    let fm = parse_frontmatter(&fs::read_to_string(&skill_md).map_err(err)?).map_err(|e| format!("{dir}：{e}"))?;
    (fm.name, fm.description, "skill", fm.license)
  } else {
    (dir.to_string(), String::new(), "shared", None)
  };
  Ok(Inspected { name, description, kind, license, has_scripts, references: skill_references(root, dir)? })
}

fn git_blob_sha(bytes: &[u8]) -> String {
  let mut hasher = Sha1::new();
  hasher.update(format!("blob {}\0", bytes.len()).as_bytes());
  hasher.update(bytes);
  hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Windows 下 git 检出会把 LF 转成 CRLF，原字节不一致时再按 LF 比一次。
fn same_blob(bytes: &[u8], sha: &str) -> bool {
  if git_blob_sha(bytes) == sha {
    return true;
  }
  if !bytes.windows(2).any(|w| w == b"\r\n") {
    return false;
  }
  let mut lf = Vec::with_capacity(bytes.len());
  for (i, b) in bytes.iter().enumerate() {
    if *b == b'\r' && bytes.get(i + 1) == Some(&b'\n') {
      continue;
    }
    lf.push(*b);
  }
  git_blob_sha(&lf) == sha
}

fn diff_local(local: &Path, upstream: &[(String, String)]) -> Result<SkillDiff> {
  let local_files = list_files(local)?;
  let local_set: HashSet<&str> = local_files.iter().map(String::as_str).collect();
  let upstream_map: HashMap<&str, &str> = upstream.iter().map(|(p, s)| (p.as_str(), s.as_str())).collect();
  let mut diff = SkillDiff::default();
  for (path, sha) in upstream {
    if !local_set.contains(path.as_str()) {
      diff.added.push(path.clone());
    } else if !same_blob(&fs::read(local.join(path)).map_err(err)?, sha) {
      diff.modified.push(path.clone());
    }
  }
  for path in &local_files {
    if !upstream_map.contains_key(path.as_str()) {
      diff.removed.push(path.clone());
    }
  }
  diff.added.sort();
  diff.modified.sort();
  Ok(diff)
}

fn parse_repo(source: &str) -> Result<String> {
  let invalid = || format!("无法识别 GitHub 仓库：{source}，请填写 owner/repo 或仓库地址");
  let s = source.trim();
  let s = s.split_once(" (").map_or(s, |(head, _)| head);
  let s = ["https://github.com/", "http://github.com/", "github.com/"]
    .iter()
    .find_map(|prefix| s.strip_prefix(prefix))
    .unwrap_or(s);
  if s.contains("://") {
    return Err(invalid());
  }
  let mut parts = s.split('/');
  let owner = parts.next().unwrap_or_default();
  let repo = parts.next().unwrap_or_default().trim_end_matches(".git");
  let valid = |p: &str| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c));
  if !valid(owner) || !valid(repo) {
    return Err(invalid());
  }
  Ok(format!("{owner}/{repo}"))
}

fn dir_of(repo: &str, path: &str) -> String {
  if path.is_empty() {
    repo.rsplit('/').next().unwrap_or(repo).to_string()
  } else {
    path.rsplit('/').next().unwrap_or(path).to_string()
  }
}

fn sibling_path(path: &str, name: &str) -> String {
  match path.rsplit_once('/') {
    Some((parent, _)) => format!("{parent}/{name}"),
    None => name.to_string(),
  }
}

fn check_dir_name(dir: &str) -> Result<()> {
  if dir.is_empty() || dir.starts_with('.') || dir.contains(['/', '\\', ':']) {
    return Err(format!("无效的 skill 目录名：{dir}"));
  }
  Ok(())
}

fn skill_status(repo: Option<&str>, tree: Option<&str>, latest: Option<&str>, checked: Option<&str>) -> &'static str {
  if repo.is_none() {
    "unlinked"
  } else if checked.is_none() {
    "unchecked"
  } else {
    match latest {
      None => "missing",
      Some(l) if Some(l) == tree => "current",
      Some(_) => "outdated",
    }
  }
}

#[derive(Deserialize)]
struct TreeEntry {
  path: String,
  #[serde(rename = "type")]
  kind: String,
  sha: String,
}

#[derive(Deserialize)]
struct RepoTree {
  sha: String,
  tree: Vec<TreeEntry>,
  truncated: bool,
}

impl RepoTree {
  fn folder_sha(&self, path: &str) -> Option<&str> {
    if path.is_empty() {
      return Some(&self.sha);
    }
    self.tree.iter().find(|e| e.kind == "tree" && e.path == path).map(|e| e.sha.as_str())
  }

  fn folder_files(&self, path: &str) -> Vec<(String, String)> {
    let prefix = if path.is_empty() { String::new() } else { format!("{path}/") };
    self
      .tree
      .iter()
      .filter(|e| e.kind == "blob")
      .filter_map(|e| e.path.strip_prefix(&prefix).map(|rel| (rel.to_string(), e.sha.clone())))
      .collect()
  }

  fn skill_paths(&self) -> Vec<String> {
    let mut paths: Vec<String> = self
      .tree
      .iter()
      .filter(|e| e.kind == "blob")
      .filter_map(|e| {
        if e.path == "SKILL.md" {
          Some(String::new())
        } else {
          e.path.strip_suffix("/SKILL.md").map(String::from)
        }
      })
      .collect();
    paths.sort();
    paths
  }

  /// 仓库中与本地目录同名的候选目录；单 skill 仓库的根目录按仓库名匹配。
  fn candidate_paths(&self, repo: &str, dir: &str) -> Vec<String> {
    let mut paths: Vec<String> = self
      .tree
      .iter()
      .filter(|e| e.kind == "tree" && dir_of(repo, &e.path) == dir)
      .map(|e| e.path.clone())
      .collect();
    if dir_of(repo, "") == dir && self.tree.iter().any(|e| e.path == "SKILL.md") {
      paths.push(String::new());
    }
    paths
  }
}

struct GitHub {
  client: Client,
  token: Option<String>,
}

fn github_token_entry() -> Result<keyring::Entry> {
  keyring::Entry::new("PaperNest", "github_token").map_err(err)
}

fn github_token() -> Result<Option<String>> {
  match github_token_entry()?.get_password() {
    Ok(token) => Ok(Some(token)),
    Err(keyring::Error::NoEntry) => Ok(None),
    Err(e) => Err(err(e)),
  }
}

impl GitHub {
  fn new() -> Result<Self> {
    let client = Client::builder().user_agent("PaperNest").timeout(Duration::from_secs(60)).build().map_err(err)?;
    Ok(Self { client, token: github_token()? })
  }

  async fn get(&self, url: reqwest::Url) -> Result<reqwest::Response> {
    let mut request = self.client.get(url.clone()).header("Accept", "application/vnd.github+json");
    if let Some(token) = &self.token {
      request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(err)?;
    let status = response.status();
    if status.is_success() {
      return Ok(response);
    }
    let body: String = response.text().await.map_err(err)?.chars().take(300).collect();
    let hint = if status.as_u16() == 403 || status.as_u16() == 429 {
      "。未认证请求每小时限 60 次，可在 Skill 库页面保存 GitHub Token"
    } else {
      ""
    };
    Err(format!("GitHub 请求失败 {status}（{url}）：{body}{hint}"))
  }

  async fn tree(&self, repo: &str) -> Result<RepoTree> {
    let url = reqwest::Url::parse(&format!("https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1")).map_err(err)?;
    let tree: RepoTree = self.get(url).await?.json().await.map_err(err)?;
    if tree.truncated {
      return Err(format!("{repo} 文件过多，GitHub 返回的目录树不完整"));
    }
    Ok(tree)
  }

  async fn raw(&self, repo: &str, path: &str) -> Result<Vec<u8>> {
    let mut url = reqwest::Url::parse("https://raw.githubusercontent.com/").map_err(err)?;
    url.path_segments_mut().expect("https URL has path segments").pop_if_empty().extend(repo.split('/')).push("HEAD").extend(path.split('/'));
    Ok(self.get(url).await?.bytes().await.map_err(err)?.to_vec())
  }
}

fn skills_root(library_dir: &Path) -> PathBuf {
  library_dir.join("skills")
}

fn prepare_staging(root: &Path, dir: &str) -> Result<PathBuf> {
  let path = root.join(".staging").join(dir);
  if path.exists() {
    fs::remove_dir_all(&path).map_err(err)?;
  }
  fs::create_dir_all(&path).map_err(err)?;
  Ok(path)
}

/// 暂存目录就位；已有同名目录先移到 `.backup/<目录名>-<时间戳>/`。
fn install_staged(root: &Path, dir: &str) -> Result<()> {
  let target = root.join(dir);
  if target.exists() {
    let backups = root.join(".backup");
    fs::create_dir_all(&backups).map_err(err)?;
    fs::rename(&target, backups.join(format!("{dir}-{}", Utc::now().format("%Y%m%d-%H%M%S")))).map_err(err)?;
  }
  fs::rename(root.join(".staging").join(dir), &target).map_err(err)
}

fn copy_dir(src: &Path, dst: &Path) -> Result<()> {
  for entry in WalkDir::new(src) {
    let entry = entry.map_err(err)?;
    let target = dst.join(entry.path().strip_prefix(src).map_err(err)?);
    if entry.file_type().is_dir() {
      fs::create_dir_all(&target).map_err(err)?;
    } else if entry.file_type().is_file() {
      fs::copy(entry.path(), &target).map_err(err)?;
    }
  }
  Ok(())
}

async fn download_folder(gh: &GitHub, repo: &str, tree: &RepoTree, path: &str, dest: &Path) -> Result<()> {
  for (rel, sha) in tree.folder_files(path) {
    let full = if path.is_empty() { rel.clone() } else { format!("{path}/{rel}") };
    let bytes = gh.raw(repo, &full).await?;
    if git_blob_sha(&bytes) != sha {
      return Err(format!("{repo}/{full} 下载内容与 GitHub 目录树不一致，请重试"));
    }
    let target = dest.join(&rel);
    fs::create_dir_all(target.parent().expect("file path has parent")).map_err(err)?;
    fs::write(&target, bytes).map_err(err)?;
  }
  Ok(())
}

async fn installed_dirs(pool: &SqlitePool) -> Result<HashSet<String>> {
  let rows = sqlx::query("SELECT dir FROM skills").fetch_all(pool).await.map_err(err)?;
  Ok(rows.iter().map(|r| r.get::<String, _>("dir")).collect())
}

async fn insert_skill(pool: &SqlitePool, dir: &str, info: &Inspected, requires: &[String], source: Option<Source<'_>>) -> Result<()> {
  let now = Utc::now().to_rfc3339();
  sqlx::query(
    "INSERT INTO skills(dir,name,description,kind,license,has_scripts,enabled,requires_json,source_repo,source_path,tree_sha,latest_tree_sha,checked_at,installed_at,updated_at) \
     VALUES(?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)",
  )
  .bind(dir)
  .bind(&info.name)
  .bind(&info.description)
  .bind(info.kind)
  .bind(&info.license)
  .bind(info.has_scripts)
  .bind(serde_json::to_string(requires).map_err(err)?)
  .bind(source.as_ref().map(|s| s.repo))
  .bind(source.as_ref().map(|s| s.path))
  .bind(source.as_ref().map(|s| s.sha))
  .bind(source.as_ref().map(|s| s.sha))
  .bind(source.as_ref().map(|_| now.clone()))
  .bind(&now)
  .bind(&now)
  .execute(pool)
  .await
  .map_err(err)?;
  Ok(())
}

async fn load_entries(pool: &SqlitePool) -> Result<Vec<SkillEntry>> {
  let rows = sqlx::query("SELECT * FROM skills ORDER BY kind DESC, dir").fetch_all(pool).await.map_err(err)?;
  rows
    .iter()
    .map(|row| {
      let source_repo: Option<String> = row.get("source_repo");
      let tree_sha: Option<String> = row.get("tree_sha");
      let latest: Option<String> = row.get("latest_tree_sha");
      let checked_at: Option<String> = row.get("checked_at");
      let status = skill_status(source_repo.as_deref(), tree_sha.as_deref(), latest.as_deref(), checked_at.as_deref());
      Ok(SkillEntry {
        dir: row.get("dir"),
        name: row.get("name"),
        description: row.get("description"),
        kind: row.get("kind"),
        license: row.get("license"),
        has_scripts: row.get("has_scripts"),
        enabled: row.get("enabled"),
        requires: serde_json::from_str(&row.get::<String, _>("requires_json")).map_err(err)?,
        source_repo,
        source_path: row.get("source_path"),
        status: status.into(),
        checked_at,
        installed_at: row.get("installed_at"),
        updated_at: row.get("updated_at"),
      })
    })
    .collect()
}

/// 依次下载 `paths`，并把它们 `../` 引用的同级目录（仓库中存在且库中没有的）一并导入。
async fn install_from_github(
  gh: &GitHub,
  pool: &SqlitePool,
  root: &Path,
  repo: &str,
  tree: &RepoTree,
  paths: Vec<String>,
  installed: &mut HashSet<String>,
) -> Result<()> {
  let mut queue = paths;
  let mut i = 0;
  while i < queue.len() {
    let path = queue[i].clone();
    i += 1;
    let dir = dir_of(repo, &path);
    check_dir_name(&dir)?;
    if installed.contains(&dir) {
      continue;
    }
    let sha = tree.folder_sha(&path).ok_or_else(|| format!("{repo} 中没有目录 {path}"))?.to_string();
    let staging = prepare_staging(root, &dir)?;
    download_folder(gh, repo, tree, &path, &staging).await?;
    let info = inspect(&root.join(".staging"), &dir)?;
    let mut requires = Vec::new();
    for name in &info.references {
      let sibling = sibling_path(&path, name);
      if installed.contains(name) || tree.folder_sha(&sibling).is_some() {
        requires.push(name.clone());
        if !installed.contains(name) {
          queue.push(sibling);
        }
      }
    }
    install_staged(root, &dir)?;
    insert_skill(pool, &dir, &info, &requires, Some(Source { repo, path: &path, sha: &sha })).await?;
    installed.insert(dir);
  }
  Ok(())
}

#[tauri::command]
pub async fn skills_list(state: State<'_, AppState>) -> Result<Vec<SkillEntry>> {
  load_entries(&*state.pool.read().await).await
}

#[derive(Deserialize)]
struct InstallManifest {
  #[serde(default)]
  repos: Vec<String>,
}

#[tauri::command]
pub async fn skills_scan_local(state: State<'_, AppState>, root: String) -> Result<LocalScan> {
  let selected = PathBuf::from(&root);
  let (source, dirs) = if selected.join("SKILL.md").is_file() {
    let parent = selected.parent().ok_or("所选目录没有上级目录")?.to_path_buf();
    let name = selected.file_name().ok_or("所选目录没有名称")?.to_string_lossy().into_owned();
    (parent, vec![name])
  } else {
    let mut dirs = Vec::new();
    for entry in fs::read_dir(&selected).map_err(err)? {
      let entry = entry.map_err(err)?;
      let name = entry.file_name().to_string_lossy().into_owned();
      if entry.file_type().map_err(err)?.is_dir() && !name.starts_with('.') && entry.path().join("SKILL.md").is_file() {
        dirs.push(name);
      }
    }
    dirs.sort();
    (selected, dirs)
  };
  let installed = installed_dirs(&*state.pool.read().await).await?;
  let skills = dirs
    .into_iter()
    .map(|dir| match inspect(&source, &dir) {
      Ok(info) => SkillCandidate {
        installed: installed.contains(&dir),
        requires: info.references.into_iter().filter(|n| source.join(n).is_dir()).collect(),
        dir,
        name: info.name,
        description: info.description,
        has_scripts: info.has_scripts,
        error: None,
      },
      Err(e) => SkillCandidate {
        installed: installed.contains(&dir),
        name: dir.clone(),
        dir,
        description: String::new(),
        has_scripts: false,
        requires: Vec::new(),
        error: Some(e),
      },
    })
    .collect();
  let manifest = source.join("_installed-from-repos.json");
  let repos = if manifest.is_file() {
    let parsed: InstallManifest = serde_json::from_str(&fs::read_to_string(&manifest).map_err(err)?)
      .map_err(|e| format!("{} 解析失败：{e}", manifest.display()))?;
    parsed.repos.iter().map(|r| parse_repo(r)).collect::<Result<Vec<_>>>()?
  } else {
    Vec::new()
  };
  Ok(LocalScan { root: source.to_string_lossy().into_owned(), skills, repos })
}

#[tauri::command]
pub async fn skills_import_local(state: State<'_, AppState>, root: String, dirs: Vec<String>) -> Result<Vec<SkillEntry>> {
  let source = PathBuf::from(&root);
  let target = skills_root(&state.library_dir);
  let pool = state.pool.read().await;
  let installed = installed_dirs(&pool).await?;
  for dir in &dirs {
    check_dir_name(dir)?;
    if installed.contains(dir) {
      return Err(format!("{dir} 已在 Skill 库中"));
    }
  }
  let mut queue = dirs.clone();
  let mut seen: HashSet<String> = dirs.into_iter().collect();
  let mut i = 0;
  while i < queue.len() {
    let dir = queue[i].clone();
    i += 1;
    let info = inspect(&source, &dir)?;
    let requires: Vec<String> = info.references.iter().filter(|n| source.join(n).is_dir()).cloned().collect();
    for dep in &requires {
      if !installed.contains(dep) && seen.insert(dep.clone()) {
        queue.push(dep.clone());
      }
    }
    copy_dir(&source.join(&dir), &prepare_staging(&target, &dir)?)?;
    install_staged(&target, &dir)?;
    insert_skill(&pool, &dir, &info, &requires, None).await?;
  }
  load_entries(&pool).await
}

#[tauri::command]
pub async fn skills_scan_github(state: State<'_, AppState>, source: String) -> Result<GithubScan> {
  let repo = parse_repo(&source)?;
  let tree = GitHub::new()?.tree(&repo).await?;
  let installed = installed_dirs(&*state.pool.read().await).await?;
  let skills = tree
    .skill_paths()
    .into_iter()
    .map(|path| {
      let dir = dir_of(&repo, &path);
      GithubSkill {
        has_scripts: tree.folder_files(&path).iter().any(|(rel, _)| is_script(rel)),
        installed: installed.contains(&dir),
        dir,
        path,
      }
    })
    .collect();
  Ok(GithubScan { repo, skills })
}

#[tauri::command]
pub async fn skills_import_github(state: State<'_, AppState>, repo: String, paths: Vec<String>) -> Result<Vec<SkillEntry>> {
  let repo = parse_repo(&repo)?;
  let gh = GitHub::new()?;
  let tree = gh.tree(&repo).await?;
  let pool = state.pool.read().await;
  let mut installed = installed_dirs(&pool).await?;
  for path in &paths {
    let dir = dir_of(&repo, path);
    if installed.contains(&dir) {
      return Err(format!("{dir} 已在 Skill 库中"));
    }
  }
  install_from_github(&gh, &pool, &skills_root(&state.library_dir), &repo, &tree, paths, &mut installed).await?;
  load_entries(&pool).await
}

/// 按目录名在候选仓库中查找来源；内容逐文件一致的优先，否则取第一个同名目录并标记与上游不同。
#[tauri::command]
pub async fn skills_link_sources(state: State<'_, AppState>, repos: Vec<String>, dirs: Option<Vec<String>>) -> Result<LinkReport> {
  let repos = repos.iter().map(|r| parse_repo(r)).collect::<Result<Vec<_>>>()?;
  let gh = GitHub::new()?;
  let mut trees = Vec::new();
  for repo in repos {
    let tree = gh.tree(&repo).await?;
    trees.push((repo, tree));
  }
  let root = skills_root(&state.library_dir);
  let pool = state.pool.read().await;
  let targets: Vec<SkillEntry> = load_entries(&pool)
    .await?
    .into_iter()
    .filter(|e| match &dirs {
      Some(dirs) => dirs.contains(&e.dir),
      None => e.source_repo.is_none(),
    })
    .collect();
  let mut report = LinkReport { linked: Vec::new(), differs: Vec::new(), unmatched: Vec::new() };
  for target in targets {
    let local = root.join(&target.dir);
    let mut chosen: Option<(&str, String, &str, bool)> = None;
    'search: for (repo, tree) in &trees {
      for path in tree.candidate_paths(repo, &target.dir) {
        let sha = tree.folder_sha(&path).expect("candidate path is a tree");
        let exact = diff_local(&local, &tree.folder_files(&path))?.is_empty();
        if exact || chosen.is_none() {
          chosen = Some((repo.as_str(), path, sha, exact));
        }
        if exact {
          break 'search;
        }
      }
    }
    let Some((repo, path, sha, exact)) = chosen else {
      report.unmatched.push(target.dir);
      continue;
    };
    sqlx::query("UPDATE skills SET source_repo=?, source_path=?, tree_sha=?, latest_tree_sha=?, checked_at=? WHERE dir=?")
      .bind(repo)
      .bind(&path)
      .bind(exact.then_some(sha))
      .bind(sha)
      .bind(Utc::now().to_rfc3339())
      .bind(&target.dir)
      .execute(&*pool)
      .await
      .map_err(err)?;
    if exact {
      report.linked.push(target.dir);
    } else {
      report.differs.push(target.dir);
    }
  }
  Ok(report)
}

#[tauri::command]
pub async fn skills_check_updates(state: State<'_, AppState>, dirs: Option<Vec<String>>) -> Result<Vec<SkillEntry>> {
  let pool = state.pool.read().await;
  let targets: Vec<SkillEntry> = load_entries(&pool)
    .await?
    .into_iter()
    .filter(|e| e.source_repo.is_some() && dirs.as_ref().map_or(true, |d| d.contains(&e.dir)))
    .collect();
  let gh = GitHub::new()?;
  let mut trees: HashMap<String, RepoTree> = HashMap::new();
  for target in &targets {
    let repo = target.source_repo.as_deref().expect("filtered to linked skills");
    if !trees.contains_key(repo) {
      trees.insert(repo.to_string(), gh.tree(repo).await?);
    }
    let latest = trees[repo].folder_sha(target.source_path.as_deref().unwrap_or_default()).map(String::from);
    sqlx::query("UPDATE skills SET latest_tree_sha=?, checked_at=? WHERE dir=?")
      .bind(latest)
      .bind(Utc::now().to_rfc3339())
      .bind(&target.dir)
      .execute(&*pool)
      .await
      .map_err(err)?;
  }
  load_entries(&pool).await
}

async fn linked_entry(pool: &SqlitePool, dir: &str) -> Result<SkillEntry> {
  let entry = load_entries(pool).await?.into_iter().find(|e| e.dir == dir).ok_or_else(|| format!("{dir} 不在 Skill 库中"))?;
  if entry.source_repo.is_none() {
    return Err(format!("{dir} 未关联 GitHub 来源"));
  }
  Ok(entry)
}

#[tauri::command]
pub async fn skills_diff(state: State<'_, AppState>, dir: String) -> Result<SkillDiff> {
  let entry = linked_entry(&*state.pool.read().await, &dir).await?;
  let repo = entry.source_repo.as_deref().expect("linked");
  let path = entry.source_path.as_deref().unwrap_or_default();
  let tree = GitHub::new()?.tree(repo).await?;
  if tree.folder_sha(path).is_none() {
    return Err(format!("{repo} 中已没有目录 {path}"));
  }
  diff_local(&skills_root(&state.library_dir).join(&dir), &tree.folder_files(path))
}

#[tauri::command]
pub async fn skills_update(state: State<'_, AppState>, dirs: Vec<String>) -> Result<Vec<SkillEntry>> {
  let root = skills_root(&state.library_dir);
  let pool = state.pool.read().await;
  let gh = GitHub::new()?;
  let mut trees: HashMap<String, RepoTree> = HashMap::new();
  let mut installed = installed_dirs(&pool).await?;
  for dir in &dirs {
    let entry = linked_entry(&pool, dir).await?;
    let repo = entry.source_repo.expect("linked");
    let path = entry.source_path.unwrap_or_default();
    if !trees.contains_key(&repo) {
      trees.insert(repo.clone(), gh.tree(&repo).await?);
    }
    let tree = &trees[&repo];
    let sha = tree.folder_sha(&path).ok_or_else(|| format!("{repo} 中已没有目录 {path}"))?.to_string();
    let staging = prepare_staging(&root, dir)?;
    download_folder(&gh, &repo, tree, &path, &staging).await?;
    install_staged(&root, dir)?;
    let info = inspect(&root, dir)?;
    let mut requires = Vec::new();
    let mut missing = Vec::new();
    for name in &info.references {
      let sibling = sibling_path(&path, name);
      if installed.contains(name) {
        requires.push(name.clone());
      } else if tree.folder_sha(&sibling).is_some() {
        requires.push(name.clone());
        missing.push(sibling);
      }
    }
    let now = Utc::now().to_rfc3339();
    sqlx::query(
      "UPDATE skills SET name=?, description=?, kind=?, license=?, has_scripts=?, requires_json=?, tree_sha=?, latest_tree_sha=?, checked_at=?, updated_at=? WHERE dir=?",
    )
    .bind(&info.name)
    .bind(&info.description)
    .bind(info.kind)
    .bind(&info.license)
    .bind(info.has_scripts)
    .bind(serde_json::to_string(&requires).map_err(err)?)
    .bind(&sha)
    .bind(&sha)
    .bind(&now)
    .bind(&now)
    .bind(dir)
    .execute(&*pool)
    .await
    .map_err(err)?;
    install_from_github(&gh, &pool, &root, &repo, tree, missing, &mut installed).await?;
  }
  load_entries(&pool).await
}

#[tauri::command]
pub async fn skills_delete(state: State<'_, AppState>, dirs: Vec<String>) -> Result<Vec<SkillEntry>> {
  let root = skills_root(&state.library_dir);
  let pool = state.pool.read().await;
  for dir in &dirs {
    check_dir_name(dir)?;
    let path = root.join(dir);
    if path.exists() {
      fs::remove_dir_all(&path).map_err(err)?;
    }
    sqlx::query("DELETE FROM skills WHERE dir=?").bind(dir).execute(&*pool).await.map_err(err)?;
  }
  load_entries(&pool).await
}

#[tauri::command]
pub async fn skills_set_enabled(state: State<'_, AppState>, dir: String, enabled: bool) -> Result<Vec<SkillEntry>> {
  let pool = state.pool.read().await;
  sqlx::query("UPDATE skills SET enabled=? WHERE dir=?").bind(enabled).bind(&dir).execute(&*pool).await.map_err(err)?;
  load_entries(&pool).await
}

#[tauri::command]
pub async fn skills_open_dir(state: State<'_, AppState>, dir: Option<String>) -> Result<()> {
  let root = skills_root(&state.library_dir);
  let path = match dir {
    Some(dir) => {
      check_dir_name(&dir)?;
      root.join(dir)
    }
    None => {
      fs::create_dir_all(&root).map_err(err)?;
      root
    }
  };
  open::that(path).map_err(err)
}

#[tauri::command]
pub async fn skills_github_token_saved() -> Result<bool> {
  Ok(github_token()?.is_some())
}

#[tauri::command]
pub async fn skills_save_github_token(token: String) -> Result<bool> {
  let entry = github_token_entry()?;
  let token = token.trim();
  if token.is_empty() {
    match entry.delete_credential() {
      Ok(()) | Err(keyring::Error::NoEntry) => Ok(false),
      Err(e) => Err(err(e)),
    }
  } else {
    entry.set_password(token).map_err(err)?;
    Ok(true)
  }
}

pub(crate) async fn enabled_skills(pool: &SqlitePool) -> Result<Vec<(String, String)>> {
  let rows = sqlx::query("SELECT dir, description FROM skills WHERE enabled=1 AND kind='skill' ORDER BY dir")
    .fetch_all(pool)
    .await
    .map_err(err)?;
  Ok(rows.iter().map(|r| (r.get("dir"), r.get("description"))).collect())
}

/// `path` 相对 skill 目录，可用 `../<依赖目录>/` 访问同级目录；结果须留在 skills/ 内且不进入隐藏目录。
fn resolve_skill_path(root: &Path, dir: &str, path: &str) -> Option<PathBuf> {
  let mut parts: Vec<&str> = vec![dir];
  for part in path.split(['/', '\\']) {
    match part {
      "" | "." => {}
      ".." => {
        parts.pop()?;
      }
      p if p.contains(':') => return None,
      p => parts.push(p),
    }
  }
  if parts.is_empty() || parts[0].starts_with('.') {
    return None;
  }
  Some(parts.iter().fold(root.to_path_buf(), |acc, p| acc.join(p)))
}

fn truncate_chars(text: String) -> String {
  let total = text.chars().count();
  if total <= SKILL_READ_CHARS {
    return text;
  }
  let head: String = text.chars().take(SKILL_READ_CHARS).collect();
  format!("{head}\n…（已截断，全文 {total} 字符）")
}

pub(crate) fn load_skill_text(library_dir: &Path, dir: &str) -> Result<String> {
  let path = skills_root(library_dir).join(dir);
  let text = fs::read_to_string(path.join("SKILL.md")).map_err(err)?;
  let mut listing = String::new();
  for rel in list_files(&path)?.into_iter().filter(|f| f != "SKILL.md") {
    let mark = if is_script(&rel) { "（脚本，PaperNest 不执行）" } else { "" };
    listing.push_str(&format!("- {rel}{mark}\n"));
  }
  Ok(format!("# {dir}/SKILL.md\n{}\n\n# 文件清单\n{listing}", truncate_chars(text)))
}

pub(crate) fn read_skill_file(library_dir: &Path, dir: &str, path: &str) -> Result<String> {
  let target = resolve_skill_path(&skills_root(library_dir), dir, path).ok_or_else(|| format!("路径超出 Skill 库范围：{path}"))?;
  if !target.is_file() {
    return Err(format!("文件不存在：{path}"));
  }
  let text = String::from_utf8(fs::read(&target).map_err(err)?).map_err(|_| format!("不是文本文件：{path}"))?;
  Ok(truncate_chars(text))
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(label: &str) -> PathBuf {
    let dir = env::temp_dir().join(format!("pn-skills-{label}-{}", Uuid::new_v4()));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn frontmatter_reads_quoted_description_and_nested_metadata() {
    let text = "---\nname: ccf-paper-reviewer\ndescription: \"Review: claims, evidence.\"\nlicense: MIT\nmetadata:\n  ccf_skill_controls:\n    shared_controls: ../ccf-common/references/\n---\n\n# Body\n---\n";
    let fm = parse_frontmatter(text).unwrap();
    assert_eq!(fm.name, "ccf-paper-reviewer");
    assert_eq!(fm.description, "Review: claims, evidence.");
    assert_eq!(fm.license.as_deref(), Some("MIT"));
  }

  #[test]
  fn frontmatter_handles_crlf_and_folded_description() {
    let text = "\u{feff}---\r\nname: x\r\ndescription: >\r\n  line one\r\n  line two\r\n---\r\nbody";
    let fm = parse_frontmatter(text).unwrap();
    assert_eq!(fm.description, "line one line two");
  }

  #[test]
  fn frontmatter_missing_is_error() {
    assert!(parse_frontmatter("# no frontmatter").is_err());
    assert!(parse_frontmatter("---\nname: x\n---\n").unwrap_err().contains("description"));
  }

  #[test]
  fn blob_sha_matches_git_and_tolerates_crlf_checkout() {
    let sha = "ce013625030ba8dba906f756967f9e9ca394464a";
    assert_eq!(git_blob_sha(b"hello\n"), sha);
    assert!(same_blob(b"hello\r\n", sha));
    assert!(!same_blob(b"hello\r\nx", sha));
  }

  #[test]
  fn references_resolve_relative_to_the_referencing_file() {
    let text = "see ../ccf-common/references/a.md and ../scripts/run.py and ../../shared-references/x.md";
    let from_skill_md = sibling_references(text, "ccf-paper-reviewer/SKILL.md");
    assert_eq!(from_skill_md.into_iter().collect::<Vec<_>>(), vec!["ccf-common", "scripts"]);
    let from_references = sibling_references(text, "ccf-paper-reviewer/references/guide.md");
    assert_eq!(from_references.into_iter().collect::<Vec<_>>(), vec!["shared-references"]);
    assert!(sibling_references("../ccf-paper-reviewer/x.md", "ccf-paper-reviewer/SKILL.md").is_empty());
  }

  #[test]
  fn skill_path_stays_inside_skills_root() {
    let root = Path::new("/lib/skills");
    assert_eq!(resolve_skill_path(root, "a", "references/x.md"), Some(root.join("a").join("references").join("x.md")));
    assert_eq!(resolve_skill_path(root, "a", "../ccf-common/x.md"), Some(root.join("ccf-common").join("x.md")));
    assert_eq!(resolve_skill_path(root, "a", "../../library.db"), None);
    assert_eq!(resolve_skill_path(root, "a", "../.backup/a-1/SKILL.md"), None);
    assert_eq!(resolve_skill_path(root, "a", "C:/Windows/win.ini"), None);
    assert_eq!(resolve_skill_path(root, "a", "..\\..\\x"), None);
  }

  #[test]
  fn repo_sources_parse() {
    assert_eq!(parse_repo("mikubaka88/CCFA-Skills (v0.10.0-r2)").unwrap(), "mikubaka88/CCFA-Skills");
    assert_eq!(parse_repo("https://github.com/Yuan1z0825/nature-skills.git").unwrap(), "Yuan1z0825/nature-skills");
    assert_eq!(parse_repo("https://github.com/a/b/tree/main/skills/x").unwrap(), "a/b");
    assert!(parse_repo("https://gitlab.com/a/b").is_err());
    assert!(parse_repo("onlyowner").is_err());
  }

  #[test]
  fn status_follows_tree_shas() {
    assert_eq!(skill_status(None, None, None, None), "unlinked");
    assert_eq!(skill_status(Some("a/b"), Some("1"), Some("1"), None), "unchecked");
    assert_eq!(skill_status(Some("a/b"), Some("1"), Some("1"), Some("t")), "current");
    assert_eq!(skill_status(Some("a/b"), Some("1"), Some("2"), Some("t")), "outdated");
    assert_eq!(skill_status(Some("a/b"), None, Some("2"), Some("t")), "outdated");
    assert_eq!(skill_status(Some("a/b"), Some("1"), None, Some("t")), "missing");
  }

  fn sample_tree() -> RepoTree {
    let entry = |path: &str, kind: &str, sha: &str| TreeEntry { path: path.into(), kind: kind.into(), sha: sha.into() };
    RepoTree {
      sha: "root".into(),
      truncated: false,
      tree: vec![
        entry("skills", "tree", "t0"),
        entry("skills/nature-reader", "tree", "t1"),
        entry("skills/nature-reader/SKILL.md", "blob", "b1"),
        entry("skills/nature-reader/references/a.md", "blob", "b2"),
        entry("skills/nature-shared", "tree", "t2"),
        entry("skills/nature-shared/x.md", "blob", "b3"),
        entry("README.md", "blob", "b4"),
      ],
    }
  }

  #[test]
  fn tree_lists_skills_and_folder_files() {
    let tree = sample_tree();
    assert_eq!(tree.skill_paths(), vec!["skills/nature-reader"]);
    assert_eq!(
      tree.folder_files("skills/nature-reader"),
      vec![("SKILL.md".to_string(), "b1".to_string()), ("references/a.md".to_string(), "b2".to_string())]
    );
    assert_eq!(tree.folder_sha("skills/nature-shared"), Some("t2"));
    assert_eq!(tree.candidate_paths("Yuan1z0825/nature-skills", "nature-shared"), vec!["skills/nature-shared"]);
    assert_eq!(sibling_path("skills/nature-reader", "nature-shared"), "skills/nature-shared");
    assert_eq!(dir_of("larashero3-dotcom/lieflat-less-ai-tone", ""), "lieflat-less-ai-tone");
  }

  #[test]
  fn diff_reports_added_removed_modified() {
    let dir = temp_dir("diff");
    fs::write(dir.join("SKILL.md"), b"hello\r\n").unwrap();
    fs::write(dir.join("old.md"), b"x").unwrap();
    fs::write(dir.join("changed.md"), b"local").unwrap();
    let upstream = vec![
      ("SKILL.md".to_string(), git_blob_sha(b"hello\n")),
      ("changed.md".to_string(), git_blob_sha(b"upstream")),
      ("new.md".to_string(), git_blob_sha(b"n")),
    ];
    let diff = diff_local(&dir, &upstream).unwrap();
    assert_eq!(diff, SkillDiff { added: vec!["new.md".into()], removed: vec!["old.md".into()], modified: vec!["changed.md".into()] });
    fs::remove_dir_all(dir).unwrap();
  }

  #[test]
  fn staged_install_backs_up_previous_version() {
    let root = temp_dir("install");
    fs::create_dir_all(root.join("x")).unwrap();
    fs::write(root.join("x").join("SKILL.md"), "old").unwrap();
    let staging = prepare_staging(&root, "x").unwrap();
    fs::write(staging.join("SKILL.md"), "new").unwrap();
    install_staged(&root, "x").unwrap();
    assert_eq!(fs::read_to_string(root.join("x").join("SKILL.md")).unwrap(), "new");
    let backups: Vec<_> = fs::read_dir(root.join(".backup")).unwrap().collect();
    assert_eq!(backups.len(), 1);
    fs::remove_dir_all(root).unwrap();
  }
}
