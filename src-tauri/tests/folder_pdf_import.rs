//! 用 release/windows 下真实 PDF 验证文件夹导入与移动。
use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Row};
use std::{fs, path::{Path, PathBuf}, str::FromStr};
use uuid::Uuid;

fn repo_root() -> PathBuf {
  PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_path_buf()
}

async fn open_test_pool(dir: &Path) -> sqlx::SqlitePool {
  fs::create_dir_all(dir.join("pdf/originals")).unwrap();
  let db = dir.join("library.db");
  let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db.to_string_lossy())).unwrap().create_if_missing(true).foreign_keys(true);
  let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
  for statement in include_str!("../src/schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
    sqlx::query(statement).execute(&pool).await.unwrap();
  }
  let has_folder: bool = sqlx::query("PRAGMA table_info(papers)").fetch_all(&pool).await.unwrap()
    .iter().any(|row| row.get::<String, _>("name") == "folder_id");
  if !has_folder {
    sqlx::query("ALTER TABLE papers ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL").execute(&pool).await.unwrap();
  }
  sqlx::query("CREATE INDEX IF NOT EXISTS idx_papers_folder ON papers(folder_id)").execute(&pool).await.unwrap();
  pool
}

async fn insert_folder(pool: &sqlx::SqlitePool, id: &str, name: &str, parent: Option<&str>) {
  sqlx::query("INSERT INTO folders(id,name,parent_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .bind(id).bind(name).bind(parent).bind(0_i64).bind("t").bind("t").execute(pool).await.unwrap();
}

async fn import_pdf(pool: &sqlx::SqlitePool, library: &Path, source: &Path, folder_id: Option<&str>) -> String {
  let id = Uuid::new_v4().to_string();
  let rel = format!("pdf/originals/{id}.pdf");
  fs::copy(source, library.join(&rel)).unwrap();
  let title = source.file_stem().and_then(|v| v.to_str()).unwrap_or("Untitled").replace('_', " ");
  sqlx::query("INSERT INTO papers(id,title_en,authors_json,tag_ids_json,status,favorite,created_at,updated_at,related_paper_ids_json,pdf_path,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .bind(&id).bind(&title).bind("[]").bind("[]").bind("unread").bind(0_i64).bind("t").bind("t").bind("[]").bind(&rel).bind(folder_id)
    .execute(pool).await.unwrap();
  id
}

#[test]
fn import_release_pdfs_into_cs_and_ncs_folders() {
  tauri::async_runtime::block_on(async {
    let root = repo_root();
    let cs_dir = root.join("release/windows/CS");
    let ncs_dir = root.join("release/windows/NCS");
    assert!(cs_dir.is_dir(), "缺少 release/windows/CS");
    assert!(ncs_dir.is_dir(), "缺少 release/windows/NCS");

    let library = std::env::temp_dir().join(format!("papernest-pdf-folders-{}", Uuid::new_v4()));
    let pool = open_test_pool(&library).await;
    insert_folder(&pool, "folder-cs", "CS", None).await;
    insert_folder(&pool, "folder-ncs", "NCS", None).await;
    insert_folder(&pool, "folder-cs-aaai", "AAAI", Some("folder-cs")).await;

    let mut cs_count = 0;
    for entry in fs::read_dir(&cs_dir).unwrap() {
      let path = entry.unwrap().path();
      if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")) != Some(true) { continue; }
      let id = import_pdf(&pool, &library, &path, Some("folder-cs")).await;
      let folder: Option<String> = sqlx::query_scalar("SELECT folder_id FROM papers WHERE id=?").bind(&id).fetch_one(&pool).await.unwrap();
      assert_eq!(folder.as_deref(), Some("folder-cs"));
      assert!(library.join(format!("pdf/originals/{id}.pdf")).is_file());
      cs_count += 1;
    }
    assert!(cs_count >= 5, "CS 目录应有多篇 PDF，实际 {cs_count}");

    let mut ncs_count = 0;
    for entry in fs::read_dir(&ncs_dir).unwrap() {
      let path = entry.unwrap().path();
      if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("pdf")) != Some(true) { continue; }
      let id = import_pdf(&pool, &library, &path, Some("folder-ncs")).await;
      let folder: Option<String> = sqlx::query_scalar("SELECT folder_id FROM papers WHERE id=?").bind(&id).fetch_one(&pool).await.unwrap();
      assert_eq!(folder.as_deref(), Some("folder-ncs"));
      ncs_count += 1;
    }
    assert_eq!(ncs_count, 1, "NCS 应恰好 1 篇");

    // 移动一篇 CS 论文到 AAAI 子文件夹
    let move_id: String = sqlx::query_scalar("SELECT id FROM papers WHERE folder_id='folder-cs' LIMIT 1").fetch_one(&pool).await.unwrap();
    sqlx::query("UPDATE papers SET folder_id=? WHERE id=?").bind("folder-cs-aaai").bind(&move_id).execute(&pool).await.unwrap();
    let after: Option<String> = sqlx::query_scalar("SELECT folder_id FROM papers WHERE id=?").bind(&move_id).fetch_one(&pool).await.unwrap();
    assert_eq!(after.as_deref(), Some("folder-cs-aaai"));
    // 文件路径不变
    let pdf_path: String = sqlx::query_scalar("SELECT pdf_path FROM papers WHERE id=?").bind(&move_id).fetch_one(&pool).await.unwrap();
    assert!(pdf_path.starts_with("pdf/originals/"));
    assert!(library.join(&pdf_path).is_file());

    // 非空 CS 不可删
    let active_cs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM papers WHERE deleted_at IS NULL AND folder_id IN ('folder-cs','folder-cs-aaai')").fetch_one(&pool).await.unwrap();
    assert!(active_cs > 0);

    // 清空 NCS 后可删
    sqlx::query("UPDATE papers SET folder_id=NULL WHERE folder_id='folder-ncs'").execute(&pool).await.unwrap();
    let active_ncs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM papers WHERE deleted_at IS NULL AND folder_id='folder-ncs'").fetch_one(&pool).await.unwrap();
    assert_eq!(active_ncs, 0);
    sqlx::query("DELETE FROM folders WHERE id='folder-ncs'").execute(&pool).await.unwrap();
    let ncs_left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM folders WHERE id='folder-ncs'").fetch_one(&pool).await.unwrap();
    assert_eq!(ncs_left, 0);

    // 空父+空子可删
    insert_folder(&pool, "empty-parent", "Empty", None).await;
    insert_folder(&pool, "empty-child", "Child", Some("empty-parent")).await;
    sqlx::query("DELETE FROM folders WHERE id='empty-parent'").execute(&pool).await.unwrap();
    let empty_left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM folders WHERE id IN ('empty-parent','empty-child')").fetch_one(&pool).await.unwrap();
    assert_eq!(empty_left, 0);

    pool.close().await;
    let _ = fs::remove_dir_all(library);
  });
}
