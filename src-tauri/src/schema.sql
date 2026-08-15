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

-- 主领域：对齐 ACM CCS 2012 顶层及国内常用 CS 研究方向拆分；每篇论文最多一个。
INSERT OR IGNORE INTO categories(id,name,color) VALUES
 ('cat-cv','计算机视觉','#7c6fcd'),
 ('cat-nlp','自然语言处理','#3b8d89'),
 ('cat-ml','机器学习','#5b7fda'),
 ('cat-ai','人工智能','#6a5acd'),
 ('cat-dm','数据挖掘与知识发现','#2f9e8f'),
 ('cat-ir','信息检索与推荐系统','#4f83cc'),
 ('cat-db','信息系统与数据库','#3d8ea5'),
 ('cat-net','计算机网络','#4682b4'),
 ('cat-sys','计算机系统与体系结构','#c27b55'),
 ('cat-se','软件工程','#b86b6b'),
 ('cat-sec','安全与隐私','#c45c6a'),
 ('cat-hci','人机交互','#9a6bb5'),
 ('cat-theory','计算理论','#708090'),
 ('cat-mm','多媒体与计算机图形学','#d17a4a'),
 ('cat-dist','分布式与并行计算','#5f8a6b'),
 ('cat-robot','机器人学','#6b8e4e');
UPDATE categories SET name='计算机系统与体系结构' WHERE id='cat-sys' AND name='系统与优化';

-- 子领域标签：可多选；覆盖常见方法、任务与阅读用途。
INSERT OR IGNORE INTO tags(id,name,color) VALUES
 ('tag-transformer','Transformer','#8b7bd6'),
 ('tag-llm','大语言模型','#6b7fd6'),
 ('tag-vlm','视觉语言模型','#7a6fcf'),
 ('tag-gnn','图神经网络','#5c8fd6'),
 ('tag-diffusion','扩散模型','#8a6bb8'),
 ('tag-rl','强化学习','#4f9b7a'),
 ('tag-transfer','迁移学习','#5a9e8c'),
 ('tag-contrastive','对比学习','#4a8f9c'),
 ('tag-federated','联邦学习','#3d8ea5'),
 ('tag-distill','知识蒸馏','#6a8f7a'),
 ('tag-continual','持续学习','#5b8a6f'),
 ('tag-fewshot','少样本学习','#6b9b6b'),
 ('tag-pretrain','预训练','#7b7fc0'),
 ('tag-detection','目标检测','#4f83cc'),
 ('tag-segmentation','语义分割','#5a7fc0'),
 ('tag-recsys','推荐系统','#4f83cc'),
 ('tag-seqrec','序列推荐','#5b8acc'),
 ('tag-retrieval','信息检索','#4682b4'),
 ('tag-dialogue','对话系统','#3b8d89'),
 ('tag-kg','知识图谱','#2f9e8f'),
 ('tag-codegen','代码生成','#6b8e4e'),
 ('tag-cf','协同过滤','#5c8fd6'),
 ('tag-os','操作系统','#c27b55'),
 ('tag-edge','边缘计算','#b86b6b'),
 ('tag-dp','差分隐私','#c45c6a'),
 ('tag-crypto','密码学','#a05060'),
 ('tag-prog-analysis','程序分析','#b86b6b'),
 ('tag-survey','综述','#d18b5b'),
 ('tag-beginner','入门','#4b9b7d'),
 ('tag-benchmark','基准评测','#c29a4a'),
 ('tag-repro','实验复现','#b89a5a');

INSERT OR IGNORE INTO settings(key,value) VALUES
 ('profile','{"displayName":"研究生同学","researchField":"计算机科学","theme":"system"}'),
 ('llm_settings','{"baseUrl":"https://api.openai.com/v1","model":"gpt-4.1-mini","autoAnalyzeOnImport":true,"visionEnabled":true}'),
 ('schema_version','2');
