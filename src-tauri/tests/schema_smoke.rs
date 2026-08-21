use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Row};
use std::{fs, str::FromStr};

#[test]
fn schema_supports_papers_and_bilingual_search() {
  tauri::async_runtime::block_on(async {
    let root = std::env::temp_dir().join(format!("papernest-schema-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let db = root.join("library.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db.to_string_lossy())).unwrap().create_if_missing(true);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
    for statement in include_str!("../src/schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) { sqlx::query(statement).execute(&pool).await.unwrap(); }
    let journal_mode = sqlx::query_scalar::<_, String>("PRAGMA journal_mode").fetch_one(&pool).await.unwrap();
    assert_eq!(journal_mode, "delete");
    sqlx::query("INSERT INTO papers(id,title_en,title_zh,authors_json,category_id,tag_ids_json,status,summary,abstract_en,abstract_zh,venue,publication_date,doi,arxiv_id,source_url,pdf_path,pdf_sha256,page_count,has_text_layer,favorite,reading_page,created_at,updated_at,deleted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("paper-test").bind("Attention Is All You Need").bind("注意力机制").bind("[]").bind(Option::<String>::None).bind("[]").bind("unread").bind("提出 Transformer").bind(Option::<String>::None).bind(Option::<String>::None).bind("NeurIPS").bind("2017").bind(Option::<String>::None).bind(Option::<String>::None).bind(Option::<String>::None).bind(Option::<String>::None).bind(Option::<String>::None).bind(15_i64).bind(1_i64).bind(0_i64).bind(1_i64).bind("2026-08-03").bind("2026-08-03").bind(Option::<String>::None).execute(&pool).await.unwrap();
    sqlx::query("INSERT INTO paper_search(paper_id,content) VALUES(?,?)").bind("paper-test").bind("Attention 注意力 Transformer").execute(&pool).await.unwrap();
    let row = sqlx::query("SELECT paper_id FROM paper_search WHERE paper_search MATCH '\"注意力\"'").fetch_one(&pool).await.unwrap();
    assert_eq!(row.get::<String,_>(0), "paper-test");
    sqlx::query("INSERT INTO tasks(id,title,due_date,status,priority,paper_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind("task-test").bind("Read paper").bind("2026-08-04").bind("todo").bind("high").bind("paper-test").bind("2026-08-03").bind("2026-08-03").execute(&pool).await.unwrap();
    let task = sqlx::query("SELECT title,paper_id FROM tasks WHERE id=?").bind("task-test").fetch_one(&pool).await.unwrap();
    assert_eq!(task.get::<String,_>(0), "Read paper");
    pool.close().await; drop(pool); let _ = fs::remove_dir_all(root);
  });
}
