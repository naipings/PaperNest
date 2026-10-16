PRAGMA journal_mode = DELETE;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_id, position);

CREATE TABLE IF NOT EXISTS papers (
  id TEXT PRIMARY KEY, title_en TEXT NOT NULL, title_zh TEXT, authors_json TEXT NOT NULL DEFAULT '[]',
  category_id TEXT, tag_ids_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'unread', summary TEXT,
  abstract_en TEXT, abstract_zh TEXT, venue TEXT, publication_date TEXT, doi TEXT, arxiv_id TEXT, source_url TEXT,
  pdf_path TEXT, pdf_sha256 TEXT, page_count INTEGER, has_text_layer INTEGER, favorite INTEGER NOT NULL DEFAULT 0,
  reading_page INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT,
  related_paper_ids_json TEXT NOT NULL DEFAULT '[]',
  folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL
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
CREATE TABLE IF NOT EXISTS paper_explains (
  paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  overview_json TEXT,
  messages_json TEXT NOT NULL DEFAULT '[]',
  active_chat_id TEXT,
  model TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS paper_explain_chats (
  id TEXT PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '新对话',
  messages_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_paper_explain_chats_paper ON paper_explain_chats(paper_id, updated_at);
CREATE TABLE IF NOT EXISTS paper_day_reads (
  day TEXT NOT NULL,
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, paper_id)
);
CREATE INDEX IF NOT EXISTS idx_paper_day_reads_day ON paper_day_reads(day);
CREATE TABLE IF NOT EXISTS deep_reads (
  id TEXT PRIMARY KEY,
  paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('library','external')),
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT,
  error TEXT,
  validation_json TEXT NOT NULL DEFAULT '[]',
  messages_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_deep_reads_updated ON deep_reads(updated_at);
CREATE TABLE IF NOT EXISTS skills (
  dir TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK(kind IN ('skill','shared')),
  license TEXT,
  has_scripts INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  requires_json TEXT NOT NULL DEFAULT '[]',
  source_repo TEXT,
  source_path TEXT,
  tree_sha TEXT,
  latest_tree_sha TEXT,
  checked_at TEXT,
  installed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('text','number','date','url','boolean','select','multiselect')),
  options_json TEXT NOT NULL DEFAULT '[]',
  position INTEGER NOT NULL DEFAULT 0,
  show_in_table INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT
);
CREATE TABLE IF NOT EXISTS paper_custom_field_values (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  field_id TEXT NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(paper_id, field_id)
);
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field ON paper_custom_field_values(field_id);

CREATE VIRTUAL TABLE IF NOT EXISTS paper_search USING fts5(paper_id UNINDEXED, content, tokenize='trigram');
CREATE VIRTUAL TABLE IF NOT EXISTS pdf_search USING fts5(paper_id UNINDEXED, page UNINDEXED, text, tokenize='unicode61 remove_diacritics 2');

-- 主领域：1997 学科目录临床医学二级学科，加专硕常用重症医学；每篇论文最多一个。
INSERT OR IGNORE INTO categories(id,name,color) VALUES
 ('cat-im','内科学','#c45c6a'),
 ('cat-surg','外科学','#c27b55'),
 ('cat-obgyn','妇产科学','#b86b6b'),
 ('cat-ped','儿科学','#d17a4a'),
 ('cat-neuro','神经病学','#7c6fcd'),
 ('cat-psych','精神病与精神卫生学','#9a6bb5'),
 ('cat-derm','皮肤病与性病学','#d18b5b'),
 ('cat-imaging','影像医学与核医学','#4f83cc'),
 ('cat-lab','临床检验诊断学','#3d8ea5'),
 ('cat-oph','眼科学','#5b7fda'),
 ('cat-ent','耳鼻咽喉科学','#4682b4'),
 ('cat-onco','肿瘤学','#6a5acd'),
 ('cat-anes','麻醉学','#5f8a6b'),
 ('cat-em','急诊医学','#c45c26'),
 ('cat-cc','重症医学','#8a3d4a'),
 ('cat-rehab','康复医学与理疗学','#2f9e8f');

-- 子领域：研究设计、临床问题、阅读用途。综述与入门与计算机科学版共用 id。
INSERT OR IGNORE INTO tags(id,name,color) VALUES
 ('tag-rct','随机对照试验','#c45c6a'),
 ('tag-nonrct','非随机干预研究','#c27b55'),
 ('tag-cohort','队列研究','#b86b6b'),
 ('tag-casecontrol','病例对照研究','#d17a4a'),
 ('tag-crosssec','横断面研究','#d18b5b'),
 ('tag-rwe','真实世界研究','#4f83cc'),
 ('tag-diagacc','诊断准确性研究','#3d8ea5'),
 ('tag-sr','系统评价','#7c6fcd'),
 ('tag-meta','荟萃分析','#6a5acd'),
 ('tag-guideline','临床指南','#5b7fda'),
 ('tag-casereport','病例报告','#9a6bb5'),
 ('tag-consensus','专家共识','#5f8a6b'),
 ('tag-dx','诊断','#4682b4'),
 ('tag-tx','治疗','#2f9e8f'),
 ('tag-px','预后','#3b8d89'),
 ('tag-prev','预防','#4f9b7a'),
 ('tag-drugtrial','药物试验','#6b7fd6'),
 ('tag-surgery','外科手术','#c27b55'),
 ('tag-imgdx','影像诊断','#4f83cc'),
 ('tag-biomarker','生物标志物','#3d8ea5'),
 ('tag-molpath','分子病理','#8a6bb8'),
 ('tag-epi','流行病学','#5a9e8c'),
 ('tag-hecon','卫生经济学','#b89a5a'),
 ('tag-stats','统计方法','#708090'),
 ('tag-consort','CONSORT','#c45c6a'),
 ('tag-prisma','PRISMA','#7c6fcd'),
 ('tag-strobe','STROBE','#4f83cc'),
 ('tag-guideline-read','指南精读','#5b7fda'),
 ('tag-proposal','课题设计','#6b8e4e'),
 ('tag-survey','综述','#d18b5b'),
 ('tag-beginner','入门','#4b9b7d');

INSERT OR IGNORE INTO settings(key,value) VALUES
 ('profile','{"displayName":"研究生同学","researchField":"临床医学","theme":"system","visualTheme":"workbench"}'),
 ('llm_settings','{"baseUrl":"https://api.openai.com/v1","model":"gpt-4.1-mini","autoAnalyzeOnImport":true,"visionEnabled":true}'),
 ('schema_version','6');
