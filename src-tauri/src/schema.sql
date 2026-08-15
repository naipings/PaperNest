PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY, title_en TEXT NOT NULL, title_zh TEXT, authors_json TEXT NOT NULL DEFAULT '[]',
  category_id TEXT, tag_ids_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'unread', summary TEXT,
  abstract_en TEXT, abstract_zh TEXT, venue TEXT, publication_date TEXT, doi TEXT, arxiv_id TEXT, source_url TEXT,
  pdf_path TEXT, pdf_sha256 TEXT, page_count INTEGER, has_text_layer INTEGER, favorite INTEGER NOT NULL DEFAULT 0,
  reading_page INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  related_paper_ids_json TEXT NOT NULL DEFAULT '[]'
);
DROP INDEX IF EXISTS idx_papers_sha;
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_papers_category ON papers(category_id);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, notes TEXT, due_date TEXT, status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','done')), priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high')), paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX IF NOT EXISTS idx_tasks_due_status ON tasks(due_date, status);
CREATE INDEX IF NOT EXISTS idx_tasks_paper ON tasks(paper_id);

CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS annotations (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, page INTEGER NOT NULL, type TEXT NOT NULL, geometry_json TEXT NOT NULL, quote TEXT, comment TEXT, color TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_annotations_paper_page ON annotations(paper_id, page);
CREATE TABLE IF NOT EXISTS vocabulary (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, term_en TEXT NOT NULL, meaning_zh TEXT NOT NULL, sentence_en TEXT, sentence_zh TEXT, page INTEGER, annotation_id TEXT, note TEXT);
CREATE TABLE IF NOT EXISTS figures (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, image_path TEXT NOT NULL, title TEXT, explanation_en TEXT, explanation_zh TEXT, page INTEGER, geometry_json TEXT, is_primary INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS excerpts (id TEXT PRIMARY KEY, paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, source_text TEXT NOT NULL, translation_zh TEXT, purpose TEXT NOT NULL, personal_rewrite TEXT, page INTEGER, annotation_id TEXT, tags_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS saved_views (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pdf_pages (paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE, page INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY(paper_id,page));

CREATE VIRTUAL TABLE IF NOT EXISTS paper_search USING fts5(paper_id UNINDEXED, content, tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS pdf_search USING fts5(paper_id UNINDEXED, page UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');

INSERT OR IGNORE INTO categories(id,name,color) VALUES
 ('cat-cv','计算机视觉','#7c6fcd'),('cat-nlp','自然语言处理','#3b8d89'),('cat-sys','系统与优化','#c27b55');
INSERT OR IGNORE INTO tags(id,name,color) VALUES
 ('tag-transformer','Transformer','#8b7bd6'),('tag-survey','综述','#d18b5b'),('tag-beginner','入门','#4b9b7d');
INSERT OR IGNORE INTO settings(key,value) VALUES
 ('profile','{"displayName":"研究生同学","researchField":"计算机科学","theme":"system"}'),
 ('llm_settings','{"baseUrl":"https://api.openai.com/v1","model":"gpt-4.1-mini","autoAnalyzeOnImport":true,"visionEnabled":true}'),
 ('schema_version','1');
