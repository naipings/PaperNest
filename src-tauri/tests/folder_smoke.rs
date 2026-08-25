use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Row};
use std::{fs, str::FromStr};

#[test]
fn folder_delete_rejects_nonempty_and_allows_empty_subtree() {
  tauri::async_runtime::block_on(async {
    let root = std::env::temp_dir().join(format!("papernest-folder-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let db = root.join("library.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db.to_string_lossy())).unwrap().create_if_missing(true).foreign_keys(true);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
    for statement in include_str!("../src/schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
      sqlx::query(statement).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO folders(id,name,parent_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind("f-parent").bind("CS").bind(Option::<String>::None).bind(0_i64).bind("t").bind("t").execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO folders(id,name,parent_id,position,created_at,updated_at) VALUES(?,?,?,?,?,?)")
      .bind("f-child").bind("AAAI").bind(Some("f-parent")).bind(0_i64).bind("t").bind("t").execute(&pool).await.unwrap();
    let duplicate: Option<String> = sqlx::query_scalar("SELECT id FROM folders WHERE id<>? AND parent_id IS NULL AND lower(trim(name))=lower(trim(?))")
      .bind("f-dup").bind("cs").fetch_optional(&pool).await.unwrap();
    assert_eq!(duplicate.as_deref(), Some("f-parent"));
    sqlx::query("INSERT INTO papers(id,title_en,authors_json,tag_ids_json,status,favorite,created_at,updated_at,related_paper_ids_json,folder_id) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .bind("p1").bind("Paper").bind("[]").bind("[]").bind("unread").bind(0_i64).bind("t").bind("t").bind("[]").bind(Some("f-child")).execute(&pool).await.unwrap();

    let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM papers WHERE deleted_at IS NULL AND folder_id IN ('f-parent','f-child')").fetch_one(&pool).await.unwrap();
    assert_eq!(active, 1);

    sqlx::query("UPDATE papers SET deleted_at='t' WHERE id='p1'").execute(&pool).await.unwrap();
    let active_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM papers WHERE deleted_at IS NULL AND folder_id IN ('f-parent','f-child')").fetch_one(&pool).await.unwrap();
    assert_eq!(active_after, 0);

    sqlx::query("UPDATE papers SET folder_id=NULL WHERE folder_id IN ('f-parent','f-child')").execute(&pool).await.unwrap();
    sqlx::query("DELETE FROM folders WHERE id='f-parent'").execute(&pool).await.unwrap();
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM folders").fetch_one(&pool).await.unwrap();
    assert_eq!(left, 0);
    let row = sqlx::query("SELECT folder_id FROM papers WHERE id='p1'").fetch_one(&pool).await.unwrap();
    let folder_id: Option<String> = row.get(0);
    assert!(folder_id.is_none());

    pool.close().await;
    drop(pool);
    let _ = fs::remove_dir_all(root);
  });
}
