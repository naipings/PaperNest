# 阅读台「解读」：与 PDF 对话

> 调研日期：2026-09-19。  
> 对照：UPDF AI（Chat with PDF / DeepThink）、PrivateGPT（LlamaIndex RAG）、CiteRAG（页级引用 + hybrid retrieval）、本仓库阅读台侧栏与 `llm_completion` / `pdf_pages` / `pdf_search`。  
> **目标**：在阅读台右侧学习侧栏增加「解读」Tab；先生成全文结构化解读，再多轮提问。  
> **实施状态：V1 已落地（0.2.38–0.2.44）** — 含多对话新建/历史切换、页码跳转、Markdown 紧凑渲染、解读进度跨界面保留。

---

## 1. 结论

| 议题 | 定稿 |
|------|------|
| 入口 | 阅读台右侧 `SideTab` 增加 **解读**（id=`explain`），与速览/批注/术语/框架/编辑并列 |
| 产品流 | 欢迎页 → 一键生成结构化解读 → 同面板继续对话（对齐 UPDF 附件 2→3，壳层用 PaperNest 浅色侧栏） |
| 模型 | 复用设置页已有 LLM（OpenAI 兼容）；V1 不做双模型切换 |
| 上下文 | **全文装得下就整篇塞**；超长则用已有 `pdf_search` FTS5 按问题取页 + 固定带上标题/摘要/解读稿 |
| 向量 RAG | V1 **不做**；本机已有 BGE（雷达用），解读场景用 FTS 足够，避免再挂 embedding 管道 |
| 持久化 | `library.db` 表 `paper_explains`：按 `paper_id` 缓存解读稿与对话；删论文级联清 |
| 触发 | 用户点「开始解读」或发送问题才调 LLM；进入 Tab 不隐式联网 |
| 与雷达解读 | 雷达解读吃摘要、服务发现层；本功能吃本地 PDF 全文、服务精读层。提示词可借鉴结构，代码分开 |

一句话：精读侧栏里的「本篇 PDF 助手」——先出结构化讲稿，再就本文提问；上下文优先整篇，撑不下再 FTS 抽页。

---

## 2. 外部调研要点

### 2.1 UPDF AI（产品参考，闭源）

公开文档与界面给出的可复用交互，不涉及内部实现：

1. **欢迎态**：展示当前文件名 / 页数 / 体积；选回复语言；主按钮「与 PDF 对话」。
2. **解读/摘要态**：进入后先对文档做结构化说明（问题、方法、结论等）。
3. **对话态**：底部输入框；可选「深度思考」；页脚「AI 生成内容，仅供参考」。
4. 能力声明：摘要、翻译、解释、语义检索、图表理解；桌面端侧栏入口。

PaperNest 对齐 **交互骨架**（欢迎 → 解读 → 对话），视觉跟现有 `.study-sidebar`，不搬 UPDF 深色壳。

### 2.2 开源成熟链路（实现参考）

| 项目 | 做法 | 对本仓库的取舍 |
|------|------|----------------|
| PrivateGPT | 解析 → chunk → embed → 向量库 → RAG chat | 完整 RAG 栈重；桌面单机已有页文本索引，V1 不引入 LlamaIndex/Qdrant |
| CiteRAG | 页级 chunk + hybrid + 页码引用 | **页码引用**值得做；hybrid/rerank 留 V2 |
| paper-qa / 学术 RAG | 文献专用提示 + 引用约束 | 提示词约束「只根据给定页文作答、标明页码」 |

对本仓库已有资产的直接映射：

```text
PDF 打开 → PdfReader 抽页文 → index_pdf_pages → pdf_pages + pdf_search(FTS5)
开始解读 → 拼装页文（封顶）→ llm_completion → 结构化 JSON → 写入 paper_explains
提问     → FTS 命中页（或全文）+ 历史消息 → llm_completion → 追加 messages
```

---

## 3. 产品形态

### 3.1 侧栏状态机

```text
idle（欢迎）
  │ 已配置 API Key ∧ 有 PDF 页文
  ▼ 点「开始解读」
loading_overview
  ▼
ready（展示解读 + 对话区）
  │ 用户提问
  ▼
streaming/asking → ready
```

欢迎页字段：标题（截断）、`PDF · {pageCount} 页`、语言选择（V1 固定简体中文一项即可扩展）、主按钮「开始解读」。  
未配置 LLM：提示去设置；页文未就绪：提示稍等或「文本层为空，可先 OCR」。

### 3.2 解读稿结构（V1）

LLM 只输出 JSON，前端渲染为卡片：

| 字段 | 含义 | 篇幅 |
|------|------|------|
| `summary` | 一句话讲这篇在干什么 | ≤60 字 |
| `problem` | 研究问题 / 动机 | ≤200 字 |
| `method` | 方法与结构（可多段） | 400–700 字 |
| `findings` | 主要结果与贡献 | ≤250 字 |
| `limits` | 局限或适用边界 | ≤150 字 |
| `readingTips` | 精读建议（读哪几节） | ≤120 字 |

与雷达 `RadarExplanation` 字段相近，但输入是全文页文，输出面向「正在读这篇 PDF 的人」。

### 3.3 对话

- 消息：`{ role: "user"|"assistant", content, cites?: number[], createdAt }`
- 回答尽量附页码（如 `P3, P7` 或 `(P2-P3)`）；点击页码滚动到阅读台对应页（`scrollIntoView`）
- 助手回答用 Markdown 渲染（`ExplainAnswerMarkdown` + remark-gfm）
- V1 不做图片上传、不做 DeepThink 双模型；输入区保留「发送」与占位「就这篇论文提问…」
- 历史按论文持久化；支持多对话（新建 / 历史切换 / 删除对话）、「删除本轮」与「重新解读」（只重跑讲稿）

---

## 4. 技术方案

### 4.1 数据表

```sql
CREATE TABLE IF NOT EXISTS paper_explains (
  paper_id TEXT PRIMARY KEY REFERENCES papers(id) ON DELETE CASCADE,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  overview_json TEXT,          -- 解读稿 JSON；未生成前为 NULL
  messages_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  updated_at TEXT NOT NULL
);
```

迁移：在现有 `schema.sql` / 启动迁移路径追加 `CREATE TABLE IF NOT EXISTS`（与其它表一致）。

### 4.2 Tauri 命令

| 命令 | 行为 |
|------|------|
| `explain_get` | 读 `paper_explains`；无行则返回空会话 |
| `explain_start` | 读 `pdf_pages`（不足则报错）→ 拼上下文 → LLM → 写 `overview_json`，清空或保留 messages 由参数 `reset_chat` 控制 |
| `explain_ask` | 组 system（论文助手）+ 检索页文 + 近期 messages + 用户问题 → LLM → append messages |
| `explain_clear_chat` | `messages_json='[]'` |
| `explain_reset` | 删行或清空 overview+messages |

前端：`backend.explainGet / explainStart / explainAsk / …`。

### 4.3 上下文拼装（Rust，单文件模块 `explain.rs`）

**解读：**

1. 取 `papers` 标题、摘要字段。
2. 取全部 `pdf_pages`，按页拼接 `【第 N 页】\n…`。
3. 字符上限约 **90_000**（与导入分析同量级）；超出时优先保留第 1–8 页、含 `abstract`/`introduction`/`method`/`conclusion` 等关键词的页、再均匀抽样剩余页。

**提问：**

1. 若全文 ≤ 45_000 字：整篇 + 解读摘要作上下文。
2. 否则：`pdf_search MATCH` 限本 `paper_id`，取 top 页（约 8–12 页）全文；始终附带标题、摘要、overview.summary。
3. system 约束：只依据提供的页文；不知则明说；引用页码。

不新增 SHA / hash 门禁；不引入向量索引表。

### 4.4 前端

| 文件 | 职责 |
|------|------|
| `src/components/PdfReader.tsx` | `SideTab` 加 `explain`；挂载面板 |
| `src/components/ExplainPanel.tsx` | 欢迎 / 解读稿 / 消息列表 / 输入框 |
| `src/components/PdfReader.css` | `.explain-*` 样式，跟侧栏变量 |
| `src/services/backend.ts` | invoke 封装 |
| `src/types.ts` | `PaperExplainOverview`、`PaperExplainMessage`、`PaperExplainSession` |
| `src-tauri/src/explain.rs` | 命令与拼装 |
| `src-tauri/src/lib.rs` | `mod explain` + handler 注册 |
| `src-tauri/src/schema.sql` | 建表 |

UI 细则：

- 解读稿用现有 `summary-card` 节奏的小卡片。
- 对话区 `flex` 列：消息可滚动，输入钉底。
- 主按钮用侧栏已有强调色；页脚一句「AI 生成内容，仅供参考。」

---

## 5. 分期

| 阶段 | 交付 | 验收 |
|------|------|------|
| **V1**（本轮） | Tab + 欢迎 + 解读生成 + 多轮问答 + FTS/全文上下文 + SQLite 缓存 + 页码跳转 | 配置 LLM 后，对一篇有文本层的 PDF 能出解读并追问；刷新侧栏会话仍在 |
| V1.1 | 回复流式输出；「重新解读」进度更细 | 长文等待体验 |
| V2 | 本地 embedding 检索；选区「拿去问解读」；可选 DeepThink 提示增强 | 超长 PDF 命中率 |

---

## 6. 测试计划

1. **单元/逻辑**：Rust 侧上下文截断与页优先规则（纯函数测，或小集成测）。
2. **手工**：`npm run tauri dev` → 打开有文本层论文 → 解读 Tab → 开始解读 → 提问「方法创新点是什么」→ 检查页码跳转。
3. **无 Key**：欢迎页提示配置，不崩。
4. **无页文**：扫描件未 OCR 时明确报错文案。
5. **打包**：`npm run tauri build` → 复制 `paper-reader.exe` 为 `release/windows/PaperNest.exe`。

---

## 7. 文档同步清单

完成本轮实现后更新：

- `docs/DEVELOPMENT.md` §2.2 阅读台：侧栏含解读；命令表登记 `explain_*`
- `docs/CHANGELOG.md`：新版本条目
- `README.md`：能力列表一行「阅读台解读 / 与 PDF 对话」
- 本文件：文首标注 **实施状态：V1 已落地**（实现后勾选）

---

## 8. 明确不做（本轮）

- 独立向量库、SHA-256 完整性门禁、多 PDF 联合会话
- 图片/拍照入对话、云端会话同步
- 复用文献调研 DSH 整套轨迹 UI（过重）
- 把雷达解读缓存与精读解读强行合并

---

## 9. 实施任务序

1. Schema + `explain.rs` 命令 + `backend.ts` 类型  
2. `ExplainPanel` UI + 接入 `PdfReader` Tab  
3. 样式与页码跳转  
4. 手工/脚本验证  
5. 文档 + 版本号 + `release/windows/PaperNest.exe`
