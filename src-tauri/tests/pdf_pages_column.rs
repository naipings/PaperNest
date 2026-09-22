use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Row};
use std::{fs, str::FromStr};

/// 回归：解读读页必须用 pdf_pages.text，不能用 content。
#[test]
fn pdf_pages_column_is_text_not_content() {
  tauri::async_runtime::block_on(async {
    let root = std::env::temp_dir().join(format!("papernest-pdf-pages-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let db = root.join("library.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db.to_string_lossy()))
      .unwrap()
      .create_if_missing(true);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
    for statement in include_str!("../src/schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
      sqlx::query(statement).execute(&pool).await.unwrap();
    }
    sqlx::query("INSERT INTO papers(id,title_en,authors_json,tag_ids_json,status,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("p1")
      .bind("Demo")
      .bind("[]")
      .bind("[]")
      .bind("unread")
      .bind(0_i64)
      .bind("2026-09-19")
      .bind("2026-09-19")
      .execute(&pool)
      .await
      .unwrap();
    sqlx::query("INSERT INTO pdf_pages(paper_id,page,text) VALUES(?,?,?)")
      .bind("p1")
      .bind(1_i64)
      .bind("hello explain")
      .execute(&pool)
      .await
      .unwrap();

    let ok = sqlx::query("SELECT page, text FROM pdf_pages WHERE paper_id=? ORDER BY page")
      .bind("p1")
      .fetch_one(&pool)
      .await
      .unwrap();
    assert_eq!(ok.get::<String, _>("text"), "hello explain");

    let bad = sqlx::query("SELECT page, content FROM pdf_pages WHERE paper_id=?")
      .bind("p1")
      .fetch_optional(&pool)
      .await;
    assert!(bad.is_err(), "content 列不应存在；误用会复现「开始解读」报错");

    pool.close().await;
    drop(pool);
    let _ = fs::remove_dir_all(root);
  });
}
