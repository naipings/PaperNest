# PaperNest「深度文献调研」功能评估与实施计划

> 调研日期：2026-08-28；修订：2026-08-28（§0 定稿：MD 交付物、项目文件夹、可追溯性、外链优先、PaperNest 作 MCP Server）。  
> **实施状态（0.2.18）**：Phase 1～10 已落地；**Phase 11 报告详度 token 调优** 已规划（§4.1，目标 0.2.19）。
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
| 报告详度 token？ | **Phase 11**：在不动 ReAct→Reviewer→Writer 流程前提下，提高 Writer 输出上限与证据摘录；并补齐多轮追问的上下文压缩覆盖（§4.1） |
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

### Phase 11 — 报告详度与多轮上下文（0.2.19，计划）

**目标**：在**不改变** ReAct → Reviewer → Writer 单次成稿流程的前提下，（1）提高 `report.md` 可写长度与 Writer 可用证据密度；（2）让同一窗口多轮追问具备与 Cursor/Codex 同类的自动上下文压缩，避免历史爆窗。

#### 11.0 上下文压缩现状审计（2026-08-30）

**已有能力（Phase 9f，对齐 Cursor/Codex 思路）**：

| 机制 | 实现 | 说明 |
| --- | --- | --- |
| 事件溯源 | `.dsh-session/session.jsonl` + `derive_openai_messages` | 追问时 `research_continue_session` **全量 DSH 重建**上下文后开新 turn |
| 自动压缩 | `research_dsh_compact::maybe_compact_if_needed` | 估算 token ≥ 窗口 **80%** 时，用 LLM 将旧对话压成 `<compacted-summary>` checkpoint |
| 尾部保留 | `retain_ratio=0.16`（约 20k tokens） | 最近消息**原文保留**，旧消息被 surface replace 折叠 |
| 工具配对 | `research_dsh_surface` tool-pairing | 压缩边界不截断未闭合的 tool call |
| 轨迹可见 | `compaction/*` 事件 + Trajectory UI | 与 `@deepseek-ai/dsh-compaction` 协议一致 |

对标 [Cursor](https://forum.cursor.com/t/summarizing-chat-context-why/102842)：接近满窗时用摘要替代最旧对话，保留近期原文——PaperNest 走同一路径（DSH checkpoint + fold），不是简单截断顶部。

**多轮追问数据流（Phase 10）**：

```text
turn 1: ReAct → Reviewer → Writer → report.md 写入 DSH
turn 2+: derive_openai_messages(全部历史) → 新 user/message → ReAct → Writer → turns/NNN.md
```

每轮完整 ReAct（含 `tool/result` **全文**）与 Writer 报告均追加进 DSH，追问次数越多，重建上下文越大。

**缺口（导致「多轮必爆」）**：

| # | 缺口 | 影响 |
| --- | --- | --- |
| G1 | 压缩**仅 `research_depth=deep` 时启用**（`research_dsh_compact.rs:171`） | 默认 **standard** 多轮追问**无压缩**，历史线性膨胀 |
| G2 | 触发阈值按 **128k 窗口 × 80% ≈ 102k** 估算 | 用户若用 32k/64k 上下文模型，API 先报错，压缩来不及触发 |
| G3 | 压缩只在 **ReAct 每轮开头**执行 | 追问入口已 `derive` 全量历史；首轮 ReAct 内会压缩，但 G1/G2 下仍可能失败 |
| G4 | 无会话外置记忆检索 | `sources.jsonl` / `turns.jsonl` 在磁盘，ReAct 上下文不靠按需加载（与 FS-Researcher 不同）；靠 DSH 压缩兜底 |
| G5 | Writer 阶段不压缩 | Writer 单次 input 变大由 11b/11d 控制；产出报告进入 DSH，下轮追问由 G1–G3 处理 |

**结论**：**有**类 Codex/Cursor 的压缩技术，但**默认调研深度下对多轮追问基本不生效**；Phase 11 用最小改动补齐 G1，并用 G2 的轻量缓解（11f）覆盖多轮场景。

**背景（报告长度对标）**：

| 项目 | 检索/推理步 | 终稿写作 |
| --- | --- | --- |
| GPT Researcher | FAST 3000 / SMART **6000**（长输出模型建议 8k–32k） | SMART 模型一次写报告 |
| Open Deep Research | Research **10000** | Final Report **10000** |
| STORM | 对话 500 | 分段 700 + 润色 **4000**（架构不同，本次不采纳） |

PaperNest 现状（0.2.18）：ReAct 每步 **1200**（硬编码）；Writer 用 `max( maxTokensPerStep, 2000 )`，默认 **4000**；`sources_block` 每条 excerpt **280** 字。设置页「单步最大 tokens」**仅 Writer 生效**，与 UI 文案不符。§8.1 回归同一问题产出约 **3.9k 字**报告，与用户「尽可能详细」目标有差距。

**约束**：

- 流程不变：不引入按节写作、不新增 Agent 角色、不改 DSH / 轨迹 / 多轮追问协议。
- 最小 diff：常量 + 设置字段 + Writer 输入宽度 + 一行 system prompt；不做 `finish_reason` 续写、不做按模型自动缩放。
- `maxTokensPerStep` 保留序列化兼容，语义改为「ReAct 等中间步默认上限（fallback）」；新增专用终稿字段。

**`ResearchLlmSettings` 增量（11a）**：

```text
max_tokens_per_step   # 已有；research_llm 未显式传 max_tokens 时的 fallback，默认 4000
report_max_tokens     # 新增；仅 Writer，默认 12000
```


| # | 改动 | 默认值 | 触及文件 |
| --- | --- | --- | --- |
| 11a | 新增 `reportMaxTokens`（`report_max_tokens`） | **12000**（UI 范围 4000–32000） | `research.rs`、`types.ts`、`ResearchSettingsForm.tsx` |
| 11a′ | 设置页文案：原「单步最大 tokens」→「中间步默认 tokens」；新增「报告最大 tokens」 | — | `ResearchSettingsForm.tsx` |
| 11b | Writer 使用 `reportMaxTokens`；超时 180s → **300s** | — | `research_writer.rs` |
| 11c | ReAct 主循环 `max_tokens` **1200 → 2000**（仅放宽 tool call / `finish_research` 的 JSON 输出空间） | 2000 | `research_react.rs` |
| 11d | Writer 专用 `sources_block_for_writer`：excerpt **280 → 800** 字/条；`research.rs` 原 `sources_block` 供 pipeline / Reviewer 不变 | 800 | `research.rs`、`research_writer.rs` |
| 11e | **去掉 `research_depth=deep` 门控**，quick / standard / deep 均启用 DSH 压缩（策略参数不变） | — | `research_dsh_compact.rs` |
| 11f | 多轮早触发：当 `turns.jsonl` 已有 ≥2 轮时，`threshold_ratio` **0.8 → 0.65**（仅估算侧） | 0.65 | `research_dsh_compact.rs`、`research_turns.rs` |

**11a–11d 之外不动**：Reviewer 800、子 Agent 900、pipeline planner 1200 / reflect 900、compaction 摘要 8192、`retain_ratio` 0.16、128k 估算窗口（G2 完整修复延后）。

**Writer system prompt 增补（一行）**：

> 按大纲充分展开各节；事实性陈述保留 `[src-xxx]`；篇幅以用户「输出要求」为准，避免提纲式缩写。

**不纳入本 Phase（显式延后）**：

- 按 `outline.md` 逐节调用 Writer（STORM / LDR 路线，需改编排）
- `finish_reason=length` 自动续写
- 按模型族自动填 token 上限 / 可配置 `contextWindow`（G2 完整修复）
- 从 `steps/` 全量灌入 Writer 上下文
- 追问前单独截断 `tool/result` 或把报告移出 DSH 表面（改事件模型）
- Cursor 式 `/summarize` 手动触发、外部向量记忆库

**权衡**：

| 选择 | 收益 | 代价 |
| --- | --- | --- |
| 只加 `reportMaxTokens` 不拆 ReAct 限额 | 用户可调终稿长度；ReAct 成本基本不变 | 设置项从 1 个变 2 个，需改 UI 文案 |
| ReAct 1200→2000 | `finish_research.summary` 不易被截断 | 每轮输出上限 +67%，单轮费用略升 |
| excerpt 800 仅 Writer | 终稿论据更厚 | Writer 单次 input token 增加；多轮时靠 11e/11f 压缩 |
| 11e 全深度启用压缩 | 默认 standard 多轮追问不再裸奔 | 更多 session 会触发压缩 LLM 调用（成本略增） |
| 11f 多轮降阈值 | 第 2 轮起更早压缩，贴近 Cursor「快满窗就摘要」 | 摘要更频繁，极长单轮仍受 128k 估算限制（G2） |
| 不做分段写作 | 实现量小、流程零变化 | 单次 12k 输出仍低于「万字综述」上限；更长报告靠多轮追问（Phase 10） |

**成功标准**：

1. §8.1 同一 query 在新默认下 `report.md` **≥ 6000 字**，且 `[src-xxx]` 引用链完整。
2. `steps/` 中 `finish_research` 的 `summary` 无 JSON 截断。
3. **多轮**：同一 session 连续 **3 轮追问**后 ReAct 正常结束；`standard` 深度下 DSH 出现 `compaction/*` 事件（证明 11e 生效）。
4. ReAct 轮次、工具表、Reviewer 门控、DSH 事件类型与 Phase 9/10 行为一致；`docs/DEVELOPMENT.md` §10 回归通过。

**实施顺序**：

1. 11a + 11b（终稿上限）
2. **11e + 11f**（多轮压缩，与报告详度并行）
3. 11d（Writer 证据宽度）
4. 11c（finish summary 空间）
5. 单轮 §8.1 复跑 + **3 轮追问**压测

**版本**：合入后发布 **0.2.19**；CHANGELOG 一条即可。

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

1. 实施 **Phase 11**（§4.1）：报告 `reportMaxTokens` + **11e/11f 多轮压缩** + Writer excerpt。
2. 单轮 §8.1 复跑 + **同一 session 3 轮追问**压测，确认 `compaction/*` 事件。
3. 若单次 12k 仍不足万字级综述，再单独立项「按节 Writer」。

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
