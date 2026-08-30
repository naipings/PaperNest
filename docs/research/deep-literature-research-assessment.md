# PaperNest「深度文献调研」功能评估与实施计划

> 调研日期：2026-08-28；修订：2026-08-28（§0 定稿：MD 交付物、项目文件夹、可追溯性、外链优先、PaperNest 作 MCP Server）。  
> **实施状态（0.2.24）**：Phase 1～11 已落地；Phase 12a `llm_web_search` 已上线（0.2.21～0.2.22）；**Phase 14 上下文圆环**已上线（0.2.24）。
> 对照：本仓库 PaperNest（Tauri 2 + React + SQLite 本地资料库）现有 LLM / 论文雷达 / 知识树能力。  
> 参考开源：[GPT Researcher](https://github.com/assafelovic/gpt-researcher)、[Stanford STORM](https://github.com/stanford-oval/storm)、[LangChain Open Deep Research](https://github.com/langchain-ai/open_deep_research)、[Local Deep Research](https://github.com/LearningCircuit/local-deep-research)、[Ariadne](https://github.com/cgarryZA/Ariadne)、[research-mcp-oss](https://github.com/aylee1024/research-mcp-oss)、[Paper-Radar Phase 6](paper-radar-feature-assessment.md)。  
> **本文档为规划产物，不含实现代码。**

---

## 结论摘要

| 问题 | 结论 |
| --- | --- |
| 有必要在 PaperNest 做「深度文献调研」吗？ | **有必要**：补齐「发现（雷达）→ 精读（阅读台）」之间的**主题级综述与证据链** |
| 主交付物是什么？ | **一份 Markdown 报告**（`report.md`），按用户问题与输出要求组织正文；过程性产物不进主报告 |
| 过程文件放哪？ | **默认工作区** `PaperNestLibrary/research/`；用户可为每次调研**指定项目文件夹**，过程文件与报告同目录 |
| 外网论文/网页怎么处理？ | **只存链接与元数据**（URL、标题、访问时间、摘要片段）；调研期**不下载**外网 PDF/HTML 到本地 |
| 可追溯、真实？ | 报告每条论断绑定 `citation_id`；`sources.jsonl` + `steps/` 保留证据链；禁止无来源断言 |
| 内置 Agent vs Codex？ | **内置 Agent 为主路径**；**PaperNest 作 MCP Server** 供 Codex/Cursor 调用本地库工具，**不做** PaperNest 内嵌调 Codex |
| 调研 LLM 配置？ | **独立** `research_llm_settings`，与整理/翻译模型分流 |
| 报告详度 token？ | **Phase 11（0.2.23）**：`reportMaxTokens` 默认 12000；Writer excerpt 800；ReAct 2000；全深度 DSH 压缩 + 多轮降阈值 |
| 对现有功能的影响？ | 独立屏幕 + `research.db`（索引）+ 文件系统交付；不改 `LibrarySnapshot` 与现有 LLM 契约 |

**定稿一句话**：调研产出是一份可打开、可版本管理的 **MD 报告**；过程落在项目文件夹；证据靠引用链与链接可追溯；Codex 通过 MCP 读你的库，而不是反过来。

---

## 0. 产品定稿（已确认）

| 编号 | 议题 | 定稿 | 说明 |
| --- | --- | --- | --- |
| R1 | 侧栏入口名 | **文献调研**（Screen=`research`） | 雷达=日更发现；调研=主题深潜 |
| R2 | 主交付物 | **`report.md`** | 存储用户要求的调研结果（结构、深度、语言由任务 prompt 约定）；UI 内预览，可用系统默认编辑器打开 |
| R3 | 过程文件 | **项目文件夹** `workspace/` | 计划、步骤日志、引用表、工具原始输出等；**不**写入 `report.md` 正文 |
| R4 | 工作区位置 | **默认** + **用户指定** | 默认：`PaperNestLibrary/research/<session-id>/`；可选：用户选定任意文件夹作为**项目根**（过程文件 + `report.md` 均在其下） |
| R5 | 索引库 | **`research.db`**（轻量） | 会话元数据、路径指针、状态；**不**把完整报告正文只存 DB |
| R6 | 外网来源 | **链接优先，不落盘** | 浏览的网页/论文只记录 URL、标题、检索/访问时间、API 返回的摘要或短摘录；**不**缓存完整 HTML/PDF 到调研目录 |
| R7 | 可追溯性 | **证据链必填** | 报告内 `[n]` 脚注 ↔ `sources.jsonl` ↔ `steps/` 中 tool 输出；无 `citation_id` 的论断不得写入终稿 |
| R8 | 设置开关 | **默认关闭** | 对齐 Crossref / 雷达 |
| R9 | 任务触发 | **双层保护：设置启用 + 页内「开始调研」** | 禁止启动时后台自动跑 Agent |
| R10 | 调研 LLM | **独立配置**（设置 → 文献调研 LLM） | Base URL / Model / API Key（Credential `research_api_key`） |
| R11 | 写回资料库 | **一律审批** | 提议导入论文、术语、任务；禁止静默写 `library.db` |
| R12 | Codex 集成 | **PaperNest 作 MCP Server** | Codex/Cursor 通过 MCP 调用 PaperNest 工具（读库、检索、雷达快照等）；**不做** PaperNest 内启动 `codex mcp-server` |
| R13 | 备份 | 默认**包含** `research/` 与 `research.db` | 体积小（无批量外网 PDF）；可设置排除 |
| R14 | 外网范围 | 用户勾选：仅本地库 / 库+arXiv / 库+多源 | 每层默认最保守；外网仅拉元数据，不下载全文文件 |

---

## 0.1 项目文件夹与交付物结构

### 默认布局

```text
PaperNestLibrary/
├── library.db
├── radar.db
├── research.db                    # 会话索引（路径、状态、摘要）
└── research/                      # 默认调研工作区根
    └── <session-id>/              # 单次调研项目文件夹
        ├── manifest.json          # 任务描述、输出要求、创建时间、工作区路径
        ├── report.md              # ★ 主交付物：用户要求的调研结果
        ├── sources.jsonl          # 可追溯来源登记（一行一条）
        ├── outline.md             # 计划大纲（过程）
        ├── steps/                 # 可选投影（Phase 9 起由 DSH 事件生成）
        ├── .dsh-session/          # Phase 9：DSH 官方 persistence（.jsonl.zstd）
        │   ├── 001-plan.json
        │   ├── 002-tool-search_library.json
        │   └── ...
        └── proposals/             # 待审批写回（可选）
            └── import-paper-*.json
```

### 用户指定项目文件夹

用户在发起调研时可选择**已有或新建**文件夹作为项目根，例如 `D:\Projects\thesis\ch2-agent-survey/`：

- `report.md` 与 `steps/`、`sources.jsonl` 均写在该目录下。
- `research.db` 只记录 `workspace_path` 绝对路径与 `session_id`。
- 便于与 Obsidian、Git、Overleaf 侧车目录协同；备份时用户自行纳入版本管理。

### `report.md` 与过程文件的边界

| 内容 | 位置 | 用户可见性 |
| --- | --- | --- |
| 综述正文、对比表、结论、用户要求的自定义章节 | `report.md` | 主界面预览 + 导出 |
| Planner 大纲、中间反思、tool 原始 JSON | `steps/` 或 `.dsh-session/` | 轨迹 Tab（**嵌入 DSH `TrajectoryView`**） |
| 来源登记表 | `sources.jsonl` | 侧栏「引用来源」列表 |
| 待入库论文提议 | `proposals/` | 审批抽屉 |

### `sources.jsonl` 单条示例（外链优先）

```json
{"id":"src-003","kind":"arxiv","url":"https://arxiv.org/abs/2401.12345","title":"...","accessed_at":"2026-08-28T10:15:00+08:00","excerpt":"API 摘要前 500 字","local_paper_id":null,"stored_locally":false}
{"id":"src-007","kind":"local","url":null,"title":"Attention Is All You Need","local_paper_id":"paper-uuid","page":3,"excerpt":"用户库内 FTS 命中片段","stored_locally":true}
```

- `stored_locally: false`：外网来源，**仅链接 + 元数据 + 短摘录**（来自 API/摘要字段，非完整网页镜像）。
- `stored_locally: true`：来自本机 `library.db` / 受管 PDF 索引，可带 `page` 与命中片段（仍不复制 PDF 到调研目录）。

---

## 0.2 可追溯与真实性约束

### 写作规则（写入 Agent system prompt）

1. **有源才写**：每个事实性陈述必须对应 `sources.jsonl` 中已有 `id`；终稿用 `[src-003]` 或 `[^3]` 标注。
2. **摘录边界**：`excerpt` 仅来自工具返回值（库内 FTS、arXiv abstract、雷达卡片摘要）；不得编造 DOI、年份、实验数字。
3. **缺口明示**：证据不足时写「现有检索未覆盖」，禁止用模型先验填补。
4. **矛盾并列**：多来源冲突时，报告内并列引用并说明分歧，不强行合并。
5. **访问时间**：外网来源记录 `accessed_at`，便于用户复核链接是否仍有效。

### 审计路径

```text
report.md 某句 [src-003]
    → sources.jsonl#src-003（url / local_paper_id / excerpt）
        → steps/00N-tool-*.json（可选投影）
        → .dsh-session/*.jsonl.zstd（DSH 官方事件流，完整 tool/result）
```

UI 支持：点击脚注 → 来源详情 → 「在论文库中打开」或「在浏览器中打开链接」。

---

## 1. 现有项目实现摘要（实现约束的基础）

### 1.1 架构与边界

```text
表现层   App.tsx 路由：library | radar | research | writing | knowledge | tasks | trash | settings
应用层   LibraryContext + backend.ts
领域层   lib.rs + radar.rs + research.rs（新）
持久层   PaperNestLibrary/{library.db, research.db, research/<session>/, ...}
```

产品边界：**本地优先、在线能力默认关、用户显式启用**。

### 1.2 现有 LLM 能力（调研已独立配置）

| 能力 | 配置来源 |
| --- | --- |
| 导入整理 / 翻译 / 分类 | `llm_settings` + `llm_api_key` |
| 雷达综述 / 单篇解读 | 同上 |

调研任务使用 **`research_llm_settings` + `research_api_key`**，避免与性价比模型混用。

### 1.3 论文雷达与调研的边界

| 维度 | 论文雷达 | 深度文献调研 |
| --- | --- | --- |
| 输出 | 卡片、短解读、日/周综述 | **`report.md` 主题报告** |
| 存储 | `radar.db` | **项目文件夹** + `research.db` 索引 |
| 外网 PDF | 入库时才下载 | **调研期不下载**；只记链接 |
| Agent | Phase 6 并入本功能写回 | 内置 Agent + MCP 只读工具 |

### 1.4 可复用资产

FTS5、`llm_completion_opts`、雷达 arXiv 元数据抓取、`knowledgeGraph.ts`、判重、`radarBusy` 进度 UI 模式。

---

## 2. 两条路径对比（修订）

### 2.1 路径 1：PaperNest 作 MCP Server（已定稿）

```text
用户在 Cursor / Codex CLI / 其他 MCP Client
        │
        ▼
PaperNest MCP Server（stdio 或 HTTP，随 Tauri 或独立子命令启动）
        │
        ├── search_library          # FTS5
        ├── get_paper               # 元数据 + 摘要
        ├── list_annotations        # 批注摘录
        ├── knowledge_neighbors     # 库内相似
        ├── radar_list_feed         # 只读快照，不触发采集
        ├── get_research_report     # 读指定 session 的 report.md（可选）
        └── list_research_sessions  # 列调研项目（可选）
```

**不做**：

- PaperNest UI 内启动 `codex mcp-server` 子进程（方案 1a）。
- PaperNest 作为 MCP Client 去连 Codex（无此需求）。

**价值**：Codex 在 IDE 里写代码、跑分析时，可直接检索你的论文库与调研项目；与内置 Agent **互补**——内置 Agent 产出 `report.md`；Codex 可读取报告与库内证据做后续工作。

**与内置 Agent 的关系**：

| 能力 | 内置 Agent | Codex + PaperNest MCP |
| --- | --- | --- |
| 发起主题调研、写 `report.md` | ✅ 主路径 | ❌ 不在 Codex 内重复实现 |
| 读本地库 / 雷达 | ✅ 内部工具 | ✅ MCP 工具 |
| 读已有 `report.md` | ✅ UI | ✅ MCP `get_research_report` |
| 写库 | 审批后 | **不提供**写库 MCP 工具（或仅 `propose_*` 需显式审批） |

### 2.2 路径 2：内置调研 Agent（主路径）

1. 用户输入研究问题 + **输出要求**（如「3000 字中文综述，含对比表与引用」）。
2. 可选指定**项目文件夹**；否则用默认 `research/<session-id>/`。
3. **react 模式**（默认）：ReAct 循环（LLM 选工具）→ Reviewer 门控（最多 2 轮补检索）→ Writer 生成 **`report.md`**。
4. **pipeline 模式**：Planner → Researcher → Reflect → Writer（设置 → 文献调研 → 调研模式 可切换）。
5. 过程写入 `steps/`、`sources.jsonl`；外网只登记链接。
6. 写回资料库走 `proposals/` + 审批。

技术形态：**Rust 编排 + React 展示**；报告以**文件**为真相来源，`research.db` 为索引。

---

## 3. 对现有功能的影响分析

### 3.1 不应改动

`LlmSettings` 语义、`LibrarySnapshot` 热路径、导入/阅读台、雷达双层采集触发。

### 3.2 允许的最小侵入

侧栏 `research`、设置分区、 `research.rs`、`research.db`、工作区目录创建、`LibraryContext.researchBusy`。

### 3.3 与论文雷达 Phase 6

写回审批并入本功能；雷达页可跳转「对该主题发起调研」，不在雷达内跑 Agent。

---

## 4. 推荐路线：分阶段实施

### Phase 0 — 定稿 ✅

§0 已确认：MD 交付、项目文件夹、外链不落盘、PaperNest MCP Server。

### Phase 1 — 基础设施 ✅（0.2.13）

- [x] `ResearchLlmSettings` + 设置页 + Credential `research_api_key`
- [x] `research.db`：会话索引
- [x] 工作区目录结构
- [x] Tauri 命令与 `ResearchView` 空壳/列表

### Phase 2 — 库内调研 MVP ✅（0.2.13）

- [x] 工具：`search_library`（经 FTS）
- [x] Agent 循环；`steps/`、`sources.jsonl`
- [x] 生成 `report.md`（脚注 `[src-xxx]`）
- [x] UI：进度、报告预览、打开文件夹

### Phase 3 — 外网元数据（链接 only）✅（0.2.13）

- [x] `search_arxiv` 元数据（`radar::search_arxiv_briefs`）
- [x] `allowWebSearch` 设置项

### Phase 4 — 质量：子角色与反思 ✅（0.2.14）

- [x] Planner / Researcher / Writer 分步（`planner-plan`、`researcher-*`、`writer-report`）
- [x] Reflect 独立步骤（`reflect` + 可选 follow-up 检索）

### Phase 5 — 写回审批 ✅（0.2.14）

- [x] `proposals/import-*.json` 自动生成（arXiv 来源且库内不存在）
- [x] 审批 UI：仅元数据 / 下载 PDF 入库 / 拒绝

### Phase 6 — PaperNest MCP Server ✅（0.2.14）

- [x] `papernest-mcp` stdio JSON-RPC；工具：`search_library`、`get_paper`、`list_research_sessions`、`get_research_report`
- [x] 设置页展示 `codex mcp add` 命令

### Phase 7 — ReAct 深循环 ✅（0.2.15）

详见 [research-react-upgrade-plan.md](research-react-upgrade-plan.md)。

- [x] **7a** 统一 `research_tools.rs`（SourceCollector）；MCP 与内置 Agent 共用；`search_annotations` / `search_excerpts`；pipeline 改调 tools 层
- [x] **7b** `research_llm_with_tools`（OpenAI function calling）+ JSON ReAct fallback
- [x] **7c** `research_react.rs` 主循环 + `research_writer.rs`；`researchMode` 切换 pipeline / react
- [x] **7d** UI：`researchDepth` / `researchMode` 设置；`ResearchView` 轮询展示 `react-tool-*` 步骤
- [x] **7e** Reviewer 质量门控（最多 2 轮补检索）
- [x] **8** `research_subtopic` 子 Agent（主 Agent 委派，共享 collector）

### Phase 9 — Trajectory 轨迹（0.2.16）

详见 [research-trajectory-plan.md](research-trajectory-plan.md)。

- [x] **9a** 接入 `@deepseek-ai/dsh-session`；Rust 写 `.dsh-session/session.jsonl`
- [x] **9b** Rust 全链路追加 DSH `SessionEventMap` 事件
- [x] **9c** 嵌入 `@deepseek-ai/dsh-client-ui-trajectory`（1:1 UI）
- [x] **9d** `research_resume_session` 恢复续跑
- [x] **9e** 分叉 + 子 Agent fork 协议（`children/`）
- [x] **9f** `@deepseek-ai/dsh-compaction`（deep 模式）

### Phase 10 — 多轮追问（0.2.17）

详见 `docs/DEVELOPMENT.md` §文献调研 Phase 10：`turns.jsonl`、`research_continue_session`、附件与 `fetch_url`。

### Phase 11 — 报告详度与多轮上下文（0.2.23）✅

ReAct → Reviewer → Writer 流程不变。落地项：

| # | 改动 | 默认值 |
| --- | --- | --- |
| 11a | `reportMaxTokens` / `report_max_tokens` | 12000（4000–32000） |
| 11a′ | 设置页「中间步默认 tokens」+「报告最大 tokens」 | — |
| 11b | Writer 用 `reportMaxTokens`；超时 300s | — |
| 11c | ReAct `max_tokens` | 2000 |
| 11d | `sources_block_for_writer` excerpt | 800 字/条 |
| 11e | DSH 压缩覆盖 quick / standard / deep | — |
| 11f | `turns.jsonl` ≥2 轮时 `threshold_ratio` | 0.65（单轮 0.8） |

**上下文压缩（Phase 9f + 11e/11f）**：`research_dsh_compact` 在 ReAct 每轮前估算 token；超阈值则用 LLM 写 `<compacted-summary>` checkpoint，旧消息经 surface replace 折叠，尾部约 16% 原文保留。机制对齐 `@deepseek-ai/dsh-compaction` 与 Cursor 会话摘要。追问路径：`research_continue_session` → `derive_openai_messages` 全量 DSH → 新 turn ReAct（压缩在同一循环内触发）。

**与 Phase 12 `llm_web_search` 的关系**：联网检索走独立 LLM 请求（`research_llm_web.rs`），`max_tokens` 仍用 `max_tokens_per_step.min(3000)`；与 11a 报告上限、`llm_native_web_search` 设置项互不冲突。

**仍延后**：按节 Writer、`finish_reason` 续写、可配置 `contextWindow`（G2）、`tool/result` 截断、外部向量记忆。

### Phase 14 — 上下文用量圆环（0.2.24）✅

> **编号说明**：Phase 12 已用于 `llm_web_search`；本节为 Phase 11 压缩策略的**可视化层**，UI 1:1 对齐 Cursor 3.3+「Context Usage」圆环与托盘，配色适配 PaperNest 亮/暗主题。

#### 14.0 目标

在「继续追问」输入框旁展示**与 Cursor 同位置、同交互**的上下文占用圆环，单击展开分项托盘，帮助用户判断是否需要压缩、开新会话或缩短追问。

统计口径：**若此刻发送追问，下一轮 ReAct 首轮 `messages` 的 token 估算**（与 `derive_openai_messages` + draft user message 同源，chars÷4，不引入 tiktoken）。

#### 14.1 Cursor 参照（1:1 复刻项）

| 元素 | Cursor 行为 | PaperNest 对齐 |
| --- | --- | --- |
| 位置 | 附件区与发送按钮之间，hint 右侧 | `ResearchComposer` actions 行：`[附件] hint … [圆环] [继续调研]` |
| 圆环尺寸 | ~20px 外径，2px 描边 | SVG `viewBox="0 0 20 20"`，`r=8`，`stroke-width=2` |
| 圆环轨道 | 低对比灰环 | `stroke: color-mix(in srgb, var(--muted) 35%, var(--line))` |
| 圆环填充 | `stroke-dasharray` 按 `percentFull` 顺时针 | 同上；≥ threshold 时 `stroke: #d97706`（亮）/ `#f59e0b`（暗） |
| 悬停 | tooltip「Show context usage」 | `title="上下文用量"`；可选轻量 CSS tooltip |
| 单击 | composer **上方**弹出托盘 | `position: absolute; bottom: 100%` 相对 composer 容器 |
| 托盘标题 | 「Context Usage」+ 关闭 | 「上下文用量」+ `×` |
| 摘要行 | `79% · ~159K / 200K tokens` | `{percent}% · ~{used}K / {window}K tokens`（中文 locale） |
| 堆叠色条 | 横向分段，高度 ~6px，圆角 | 各 bucket 宽度 = `tokens / usedTokens` |
| 分项列表 | 色点 + 标签 + 右对齐 token | 同结构，5 类（见下表） |
| 压缩提示 | 接近满时一行警告 | `nearCompaction` 时显示「接近压缩阈值，发送后将自动摘要旧对话」 |

**首版不做**：轨迹 Tab 重复一套、按模型动态 context window（G2）、与 API `usage` 字段逐轮对齐。

#### 14.2 分项（buckets）

遍历 `fold_surface` 后 `derive_openai_messages` 结果，按消息归类：

| id | 标签 | 归类规则 | 色条色（亮 / 暗） |
| --- | --- | --- | --- |
| `system` | 系统提示 | 首条 `role=system` 内容 | `--accent` / `--accent` |
| `tools` | 工具定义 | `request/header` 序列化的 tools JSON（÷4） | `--sky` / `--sky` |
| `compacted` | 已压缩摘要 | `user` 含 `<compacted-summary>` | `#a855f7` / `#c084fc` |
| `conversation` | 对话与工具结果 | 其余 user / assistant / tool | `--brand` / `--brand` |
| `draft` | 未发送追问 | 前端传入 draft 文本 + 附件估算 | `var(--muted)` |

#### 14.3 后端：`research_context_usage`

```text
输入：sessionId, draftQuestion?: string, draftAttachmentChars?: number
输出：ResearchContextUsage
```

```typescript
interface ResearchContextUsage {
  contextWindow: number;      // 128_000（与 CompactionPolicy 一致）
  thresholdRatio: number;     // turns≥2 → 0.65，否则 0.8
  usedTokens: number;
  percentFull: number;
  nearCompaction: boolean;    // used >= thresholdRatio * contextWindow
  buckets: { id: string; label: string; tokens: number }[];
}
```

- 新建 `src-tauri/src/research_context_usage.rs`，复用 `estimate_openai_message_tokens`、`CompactionPolicy::for_session(turn_count)`、`research_dsh_load_snapshot`。
- Tauri command 注册于 `lib.rs`；单元测试覆盖：空会话、含 compaction、含 draft 预览。
- 与 Phase 11 压缩**只读**：不触发压缩，仅报告当前 DSH 派生体积。

#### 14.4 前端组件

| 文件 | 职责 |
| --- | --- |
| `ResearchContextRing.tsx` | SVG 圆环 + 点击/悬停 |
| `ResearchContextPanel.tsx` | 托盘：标题、摘要、堆叠条、分项列表、压缩提示 |
| `styles.css` | `.research-context-ring`、`.research-context-panel`（托盘 `background: var(--panel)`、`border: 1px solid var(--line)`、`box-shadow` 对齐现有浮层） |

**接入**：

- `ResearchComposer` 新增可选 props：`sessionId?`、`showContextRing?`、`draftQuestion`（即 `value`）。
- `ResearchConversationTab` 在 `canFollowUp` 时传 `sessionId` 并开启圆环。
- 刷新：`sessionId` 变化、步骤轮询、`value` debounce 300ms、发送追问后。

#### 14.5 实施切片（推荐顺序）

| 步骤 | 内容 | 验收 |
| --- | --- | --- |
| 14a | `research_context_usage` + 测试 | `cargo test research_context_usage` |
| 14b | 圆环仅总量百分比 | 追问框旁可见环，hover 有 title |
| 14c | 单击托盘 + 分项色条 | 布局与 Cursor 截图一致（亮主题） |
| 14d | draft 实时预览 + `nearCompaction` 文案 | 输入追问时 `draft` 分项变化 |
| 14e | 暗主题走查 + 文档/CHANGELOG 0.2.24 | 切换 `data-theme=dark` 无色条不可读 |

预估 **0.5～1 天**；与 `llm_web_search`、Phase 11 无冲突。

---

## 5. 数据模型

### 5.1 `research.db`（索引层）

```text
research_sessions
  id, title, query, output_requirements, status,
  workspace_path, report_path,   -- 通常 workspace/report.md
  created_at, updated_at, token_usage, error

research_session_tags          -- 可选：用户标签、关联文件夹名
  session_id, tag
```

完整报告正文以 **`report.md` 文件为准**；DB 可缓存 `report_preview`（前 500 字）供列表展示，须与文件同步。

### 5.2 文件层（真相来源）

| 文件 | 用途 |
| --- | --- |
| `manifest.json` | 任务 query、output_requirements、模型、外网开关 |
| `report.md` | **交付物** |
| `sources.jsonl` | 可追溯来源 |
| `outline.md` | 计划 |
| `steps/*.json` | 过程日志 |
| `proposals/*.json` | 写回提议 |

### 5.3 与 `library.db` 关系

无跨库 FK。`local_paper_id` 软引用；论文删除后 `sources.jsonl` 保留但 UI 标「本地记录已删除」。

---

## 6. Agent 工具表（V1～V2）

| 工具 | 数据源 | 默认 | 本地落盘 |
| --- | --- | --- | --- |
| `search_library` | FTS5 | 开 | 否（只记命中片段到 sources） |
| `get_paper` | papers | 开 | 否 |
| `get_paper_chunks` | pdf_pages | 关 | 否（摘录进 sources.jsonl only） |
| `list_annotations` | annotations | 开 | 否 |
| `knowledge_neighbors` | L1 图 | 开 | 否 |
| `search_arxiv` | arXiv API | 关 | **否**（url + abstract only） |
| `radar_search` | radar.db | 关 | 否 |
| `fetch_web_metadata` | HTTP HEAD/元数据 | V2 | **否**（禁止存 HTML body） |
| `propose_import` | — | 开 | 写 `proposals/` only |

---

## 7. 主要权衡

| 权衡 | 选择 | 代价 |
| --- | --- | --- |
| 报告存 DB vs 文件 | **MD 文件** | 列表预览需读盘或缓存摘要 |
| 外网全文缓存 | **不缓存** | 离线无法重读原网页；靠链接复核 |
| 默认工作区 vs 用户项目夹 | **两者都支持** | 路径管理略复杂 |
| Codex 方向 | **PaperNest = MCP Server** | 需维护 MCP 协议与文档 |
| 内置 Agent | **主路径** | 与 MCP 工具实现需复用同一 Rust 层 |

---

## 8. 成功标准

1. Phase 2 完成：库内主题调研产出 **`report.md`**，满足用户输出要求。
2. 任意报告论断可追溯到 `sources.jsonl` + `steps/`。
3. Phase 3 后：外网引用仅有 URL/元数据，工作区**无**外网 PDF/HTML 文件。
4. 用户可将项目文件夹设在资料库外，过程文件与报告同目录。
5. 整理 LLM 与调研 LLM 独立配置、互不影响。
6. Phase 6：Codex 通过 MCP 检索本地库；PaperNest 不内嵌 Codex。
7. `docs/DEVELOPMENT.md` §10 回归全部通过。

---

## 8.1 回归验证（2026-08-30，0.2.18）

查询：「推荐系统冷启动方向的研究的最新进展，截止2026年8月。」

| 项 | 结果 |
| --- | --- |
| 本地检索 | `search_library` 命中 10 条，摘要为论文 abstract，无 `authors_json` 泄漏 |
| 外网检索 | arXiv 34 + OpenAlex 31 + Crossref 6；`fromYear` 过滤生效 |
| 工具自主调用 | 22 次 tool call，Agent 自行 `finish_research` 产出报告 |
| 报告 | `report.md` 约 3.9k 字，引用 `[src-xxx]` 贯穿全文（Phase 11 目标 ≥6k 字） |
| 轨迹 | DSH 114 事件，Trajectory 页正常渲染，无重复 step 报错 |
| 中断恢复 | 应用重启后残留 `running` 会话标为 `failed`，可从轨迹恢复点续跑 |

---

## 9. 建议的下一步

1. 用 §8.1 query 复跑，核对报告字数是否达到 6k+。
2. 同一 session 连续 3 轮追问，检查 DSH `compaction/*` 与轨迹页。
3. 万字级综述需求：单独立项「按节 Writer」。

---

## 附录 A — 路径决策树（修订）

```text
深度文献调研
    │
    ├─ 在 PaperNest 内完成主题报告？
    │     └─ 是 → 内置 Agent → report.md（主路径）
    │
    ├─ 在 Codex/Cursor 里继续用论文库？
    │     └─ 是 → PaperNest MCP Server（只读工具 + 可选读 report.md）
    │
    └─ 需要把外网 PDF 存到调研目录？
          └─ 否（定稿）→ 仅 sources.jsonl 链接；入库走审批下载到 pdf/originals
```

---

## 附录 B — 本仓库参考文件

| 路径 | 用途 |
| --- | --- |
| `docs/DEVELOPMENT.md` | 架构与回归 |
| `docs/research/paper-radar-feature-assessment.md` | 雷达 Phase 6 写回 |
| `src-tauri/src/lib.rs` | `llm_completion_opts` |
| `src-tauri/src/radar.rs` | arXiv 元数据（抽取复用，不下载 PDF） |
| `src/components/RadarView.tsx` | 长跑任务 UI |

---

## 附录 C — 开源项目链接速查

| 项目 | URL |
| --- | --- |
| GPT Researcher | https://github.com/assafelovic/gpt-researcher |
| STORM | https://github.com/stanford-oval/storm |
| Open Deep Research | https://github.com/langchain-ai/open_deep_research |
| Local Deep Research | https://github.com/LearningCircuit/local-deep-research |
| OpenAI Codex MCP | https://openai-codex.mintlify.app/configuration/mcp-servers |
