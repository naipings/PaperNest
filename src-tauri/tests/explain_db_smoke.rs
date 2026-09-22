use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, Row};
use std::{fs, str::FromStr};

/// 模拟解读读页 + 写入 paper_explains（不含真实 LLM）。
#[test]
fn explain_db_path_reads_text_and_stores_overview() {
  tauri::async_runtime::block_on(async {
    let root = std::env::temp_dir().join(format!("papernest-explain-db-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let db = root.join("library.db");
    let options = SqliteConnectOptions::from_str(&format!("sqlite:{}", db.to_string_lossy()))
      .unwrap()
      .create_if_missing(true)
      .foreign_keys(true);
    let pool = SqlitePoolOptions::new().max_connections(1).connect_with(options).await.unwrap();
    for statement in include_str!("../src/schema.sql").split(';').map(str::trim).filter(|s| !s.is_empty()) {
      sqlx::query(statement).execute(&pool).await.unwrap();
    }

    sqlx::query("INSERT INTO papers(id,title_en,authors_json,tag_ids_json,status,favorite,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .bind("paper-explain")
      .bind("ScholarNodes Demo")
      .bind("[]")
      .bind("[]")
      .bind("reading")
      .bind(0_i64)
      .bind("2026-09-19T00:00:00Z")
      .bind("2026-09-19T00:00:00Z")
      .execute(&pool)
      .await
      .unwrap();

    for (page, text) in [
      (1_i64, "Abstract We propose ScholarNodes for interdisciplinary recommendation."),
      (2_i64, "Method Content-based filtering over scholarly social networks."),
      (3_i64, "Experiments on five datasets show improved community discovery."),
    ] {
      sqlx::query("INSERT INTO pdf_pages(paper_id,page,text) VALUES(?,?,?)")
        .bind("paper-explain")
        .bind(page)
        .bind(text)
        .execute(&pool)
        .await
        .unwrap();
      sqlx::query("INSERT INTO pdf_search(paper_id,page,text) VALUES(?,?,?)")
        .bind("paper-explain")
        .bind(page)
        .bind(text)
        .execute(&pool)
        .await
        .unwrap();
    }

    let pages = sqlx::query("SELECT page, text FROM pdf_pages WHERE paper_id=? ORDER BY page")
      .bind("paper-explain")
      .fetch_all(&pool)
      .await
      .unwrap();
    assert_eq!(pages.len(), 3);
    assert!(pages[0].get::<String, _>("text").contains("ScholarNodes"));

    let overview = r#"{"summary":"提出 ScholarNodes","problem":"跨学科社群难发现","method":"内容过滤","findings":"效果提升","limits":"数据有限","readingTips":"先读方法节"}"#;
    sqlx::query(
      "INSERT INTO paper_explains(paper_id,locale,overview_json,messages_json,model,updated_at)
       VALUES(?,?,?,?,?,?)
       ON CONFLICT(paper_id) DO UPDATE SET overview_json=excluded.overview_json, updated_at=excluded.updated_at",
    )
    .bind("paper-explain")
    .bind("zh-CN")
    .bind(overview)
    .bind("[]")
    .bind("test-model")
    .bind("2026-09-19T12:00:00Z")
    .execute(&pool)
    .await
    .unwrap();

    let stored: String = sqlx::query_scalar("SELECT overview_json FROM paper_explains WHERE paper_id=?")
      .bind("paper-explain")
      .fetch_one(&pool)
      .await
      .unwrap();
    assert!(stored.contains("ScholarNodes"));

    let hit = sqlx::query(
      "SELECT page, text FROM pdf_search WHERE pdf_search MATCH ? AND paper_id=? ORDER BY bm25(pdf_search) LIMIT 3",
    )
    .bind("\"filtering\"")
    .bind("paper-explain")
    .fetch_all(&pool)
    .await
    .unwrap();
    assert!(!hit.is_empty());

    pool.close().await;
    drop(pool);
    let _ = fs::remove_dir_all(root);
  });
}
