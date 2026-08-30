# 文献调研 Trajectory 轨迹方案（Phase 9）

> 版本：0.2.16 规划；状态：**9f 完成**  
> 前置：Phase 7 ReAct + Phase 7e Reviewer + Phase 8 子 Agent（0.2.15）  
> 策略：**复用 DSH 官方 Session / Trajectory UI**；持久化由 **Rust 写 DSH 兼容 JSONL**  
> 上游：[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（BSD-3-Clause）

---

## 1. 目标

文献调研接入 DSH 事件溯源体系，Trajectory 视图 **直接嵌入官方 `TrajectoryView`**，外观与交互与 DSH 1:1 一致；业务内容适配 PaperNest（ReAct、Reviewer、子 Agent、Writer、`sources.jsonl` / `report.md`）。

核心不变量（来自 DSH，不自行改写）：

1. **Model-visible means recorded** — 见 [dsh-session README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/README.md)
2. **`Session` 仅追加日志为唯一真相** — `deriveMessages()` 派生 LLM 历史，禁止旁路维护 `messages[]`
3. **恢复、分叉、检索、回放** — 共用 `.dsh-session/session.jsonl`；Webview 用 `Session.create({ seed })` + `SessionStore.fork`

---

## 2. 选定架构（基于项目现状）

### 2.0 为何不用「全 JS Harness」或「全 Rust 自研」

| 方案 | 结论 |
|------|------|
| Webview 内跑 `dsh-session-persistence-jsonl` | **不可行**：依赖 Node `fs` + `koffi`（zstd），Tauri Webview 无 Node 运行时 |
| 独立 Node sidecar | 运维复杂，与「单 exe + papernest-mcp」风格不一致 |
| Rust 自研 `derive_messages` + 自绘 Trajectory UI | 与 DSH 漂移，违背复用目标 |
| **Rust 写盘 + Webview 读 Session/UI** | **采用**：Agent 在 Rust 跑（不依赖页面挂载）；UI 复用官方包 |

### 2.1 混合桥接（Rust 写 · Webview 读）

```text
调研运行（Rust，任意页面）
  research_react / reviewer / writer
    → research_dsh_store::append_event（DSH SessionEvent 信封）
    → workspace/.dsh-session/session.jsonl（compression: none）

轨迹展示（Webview，文献调研页）
  research_dsh_load_snapshot（Tauri）
    → sessionBridge.hydrateSession
    → Session.create(id, seed, header)
    → deriveMessages / 未来 TrajectoryView

分叉 / 恢复（9d/9e）
  Rust 复制 jsonl 前缀 → Webview Session.create({ seed })
  或 Webview SessionStore.fork（用户交互时）
```

**分工表**

| 层 | 技术 | 职责 |
|----|------|------|
| 持久化 | `research_dsh_store.rs` | DSH 兼容 header + 事件行；`compression: none` 明文 JSONL |
| 会话语义 | `@deepseek-ai/dsh-session`（Webview） | `deriveMessages`、`append` 校验、`fork` |
| Agent | Rust `research_*` | 工具、LLM、写事件 |
| UI | `@deepseek-ai/dsh-client-ui-trajectory`（9c） | 1:1 Trajectory，不手写 CSS |

**不在 Webview 加载的包**：`dsh-session-persistence-jsonl`、`dsh-session-checkpoint-policy`（留给纯 Node 环境；PaperNest 用 Rust 写同格式明文 JSONL）。

---

## 3. 复用边界：用什么、不写什么

### 3.1 直接复用（npm）

| 官方包 | PaperNest 用法 |
|--------|----------------|
| `@deepseek-ai/dsh-session` | `Session.create` / `deriveMessages` / `fork`（Webview） |
| `@deepseek-ai/dsh-client-ui-trajectory` | 轨迹 Tab（9c） |
| `@deepseek-ai/dsh-client-ui-conversation` | 对话/轨迹双 Tab 壳（9c） |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 子 Agent 分叉（9e） |
| `@deepseek-ai/dsh-compaction` | deep 模式压缩（9f） |

### 3.2 Rust 实现（薄存储层，非自研语义）

| 模块 | 职责 |
|------|------|
| `research_dsh_store.rs` | 写/读 `.dsh-session/session.jsonl`；事件信封对齐 DSH |
| `research_dsh_append_event` / `research_dsh_load_snapshot` | Tauri 命令 |

### 3.3 保留在 Rust（领域）

| 模块 | 原因 |
|------|------|
| `research_tools` | 本地 FTS、arXiv、批注；MCP 共用 |
| `research_react` / `reviewer` / `writer` / `subagent` | 与 `library.db`、工作区绑定 |
| `sources.jsonl`、`report.md`、`proposals/` | 产品交付物 |

### 3.4 明确不实现

- ~~自研 `derive_messages`~~
- ~~自研 Trajectory UI / CSS~~
- ~~Webview 内跑 persistence-jsonl~~
- ~~Node sidecar Harness~~

---

## 4. 数据流与目录

```text
┌─ Webview ─────────────────────────────────────────────┐
│  ResearchHarnessProvider + sessionBridge.ts            │
│  （9c 嵌入 TrajectoryView）                             │
└───────────────────────────┬───────────────────────────┘
                            │ invoke load / append
┌─ Rust ────────────────────┴───────────────────────────┐
│  research_react → research_dsh_store::append_event    │
└───────────────────────────────────────────────────────┘
         ▼
research/<id>/.dsh-session/session.jsonl   # 行1 header，后续 SessionEvent
```

### 4.1 工作区目录

```text
research/<session-id>/
  .dsh-session/
    session.jsonl            # type:session 头行 + 事件行（明文，与 DSH 信封一致）
  manifest.json              # 含 dshSessionId（默认 = research session id）
  sources.jsonl | report.md | steps/ | proposals/
```

`steps/` 可选，由事件投影；**Trajectory 以 `.dsh-session` 为准**。

### 4.2 事件词汇：DSH `SessionEventMap` only

Rust 桥接层只追加 DSH 已定义类型，**不发明** `system/prompt`、`llm/request` 等私有 type：

| DSH 事件 | 调研场景 |
|----------|----------|
| `turn/start` · `turn/end` · `step/start` · `step/end` | ReAct 轮次边界 |
| `user/message`（`source: user`） | 研究问题、输出要求 |
| `user/message`（`source: inject` 等） | nudge、Reviewer 备忘、补检索说明 |
| `request/header` | system prompt + tools schema 快照（含 `system` 字段） |
| `assistant/message` | LLM 回复 + `tool_calls` + `usage` |
| `assistant/chunk` | 启用 stream 时的 token 块（Phase 9 后期） |
| `tool/call` · `tool/result` | `search_library`、`finish_research` 等；**result 全文，不截断** |
| `session/end-seed` | fork / resume 后首条 live 事件（DSH 构造器写入） |

Reviewer / Writer 阶段：

- Reviewer 输入输出用 `user/message`（inject）+ `assistant/message` 记录，或 declaration-merge 扩展 log-only 类型（需评估是否与 Trajectory 徽章兼容；优先用官方 `user/message` + `source` 区分）。
- Writer 的 system/user 通过 `request/header` + `assistant/message` 记录；`report.md` 仍写文件系统。

子 Agent：加载 `@deepseek-ai/dsh-subagent-fork-in-process`，主 session `fork` 出子 session，`research_subtopic` 委派时走官方 in-process 分叉协议。

### 3.3 `surfaceOp` 与 append 规则

所有 surface-eligible 事件必须带正确 `surfaceOp`（`append` / `surface-replace` 等），由 **JS Bridge 调用 `session.append(type, data, opts)`** 完成校验；Rust 只传 JSON，不实现 surface 逻辑。

开发期启用 `@deepseek-ai/dsh-session/invariant` 插件，自动检查 seq 单调、turn/step 闭合、tool call/result 配对。

---

## 4. UI：嵌入官方 Trajectory，1:1 外观

### 4.1 实现方式

**不复制 DSH 样式表**。在 `ResearchView` 调研详情区：

1. 用 `@deepseek-ai/dsh-client-ui-conversation` 注册 `conversation.view` 槽位。
2. 轨迹 Tab 直接渲染 `TrajectoryView`（与 DSH Web UI 同组件同 CSS）。
3. 通过 `useSession` 订阅 `ctx.sessions` 中当前调研的 `dshSessionId`。
4. 对话 Tab 保留 PaperNest 内容：`report.md`、提案审批、`sources.jsonl` 列表。

外观、热图、虚拟列表、Inspector 五 Tab（Summary / Payload / Result / Schema / Timing）、搜索与 Export **全部由官方包提供**，PaperNest 仅提供容器尺寸与 `dshSessionId` 绑定。

### 4.2 PaperNest 适配点（不改变 DSH 视觉）

| 项 | 适配 |
|----|------|
| Task rail 标签 | 映射 `turn` 为「ReAct 第 N 轮」；子 session 显示子问题标题 |
| Schema Tab | 注册 PaperNest 工具 schema（`research_tools` 的 OpenAI JSON）到 `callSchemas` |
| 底栏 Resume / Fork | 调用 `SessionStore.fork` + `research_resume_session`（Rust 续跑） |
| 运行中刷新 | 监听 `session/event` 推送，**取代** 对 `steps/` 的 1.5s 轮询 |

### 4.3 前端新增文件（薄封装）

```text
src/research-harness/
├── bootstrap.ts              # Cordis App + session / persistence / checkpoint 插件
├── sessionBridge.ts            # append、load、fork、getSessionIdForResearch
├── plugins/
│   └── papernest-tools.ts      # 工具 schema 注册（供 Trajectory Schema Tab）
└── ResearchHarnessProvider.tsx # Context 包裹 ResearchView 详情区

src/components/research/
├── ResearchView.tsx              # 挂 Harness Provider；双 Tab
└── ResearchConversationTab.tsx   # 原报告/提案/来源（对话 Tab）
```

**删除原计划**中的 `ResearchTrajectoryView.tsx`、`TrajectoryHeatmap.tsx`、`trajectoryTheme.css` 等自研 UI 文件。

---

## 5. Tauri API（修订）

| 命令 | 实现 |
|------|------|
| `research_dsh_append` | Rust → Webview：`sessionBridge.append(sessionId, type, data, opts)` |
| `research_dsh_derive_messages` | Webview：`session.deriveMessages()` → 返回 JSON 供 Rust LLM 请求组装 |
| `research_dsh_fork` | Webview：`ctx.sessions.fork(source, boundary)` → 新 `dshSessionId` + 新 workspace |
| `research_dsh_load` | 打开调研任务时：`persistence.load` 或 `create({ seed })` |
| `research_bind_dsh_session` | 创建调研任务时：`ctx.sessions.create` 并写入 `manifest.dshSessionId` |

保留 `research_list_steps` 作为投影兼容；**不再新增** `research_list_events` 自研 API——UI 直接读 DSH `Session`。

调研运行主路径：

```text
research_run_session
  → research_dsh_load（确保 Session 在 Webview 就绪）
  → ReAct 循环每步 research_dsh_append
  → LLM 前 research_dsh_derive_messages
  → 结束后 Writer 写 report.md；DSH 日志已完整
```

---

## 6. 依赖与版本

在 `package.json` 增加（实施时锁定与 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) monorepo 同版本）：

```json
{
  "@deepseek-ai/dsh-session": "<pin>",
  "@deepseek-ai/dsh-session-persistence-jsonl": "<pin>",
  "@deepseek-ai/dsh-session-checkpoint-policy": "<pin>",
  "@deepseek-ai/dsh-client-ui-trajectory": "<pin>",
  "@deepseek-ai/dsh-client-ui-conversation": "<pin>",
  "@deepseek-ai/dsh-client-ui-primitives": "<pin>",
  "@deepseek-ai/dsh-subagent-fork-in-process": "<pin>"
}
```

- 许可证：上游 MIT，在 `NOTICE` 或关于页注明 DSH 组件来源。
- Cordis 核心随上述包传递依赖引入，不单独猜版本。
- 若 npm 包暂不可用，以 **git submodule + workspace 引用** `deepseek-harness/packages/*` 同路径依赖（与官方 `agent-spine-demo` 一致）。

---

## 7. 分阶段实施（按复用优先排序）

### Phase 9a — Harness 引导与 Rust JSONL 存储（完成）

- [x] `research_dsh_store.rs` + `.dsh-session/session.jsonl`
- [x] `research_dsh_load_snapshot` / `research_dsh_append_event`
- [x] `src/research-harness/sessionBridge.ts` + `ResearchHarnessProvider`
- [x] 创建任务时写入 `turn/start` + 首条 `user/message`
- [x] Vite `node:path` / `node:module` shim，使 `@deepseek-ai/dsh-session` 可在 Webview 打包

### Phase 9b — Rust 全链路写 DSH 事件（完成）

- [x] `research_dsh_log.rs`（`DshRecorder`）
- [x] `research_react` 每轮写 `turn/*`、`step/*`、`request/header`、`assistant/message`、`tool/call`、`tool/result`
- [x] Reviewer / Writer / Subagent / Pipeline 同步写事件
- [x] `tool/result` 全文，不截断

### Phase 9c — 官方 Trajectory UI（完成）

- [x] `moduleLoader.ts` 加载 DSH client bundle（`__ModuleLoader__` shim）
- [x] `bootstrap.ts` 挂载 `@deepseek-ai/dsh-client-ui-trajectory` + `ConversationNodeAssembler` 同步
- [x] `ResearchTrajectoryPanel` 渲染官方 `TrajectoryView`（经 `SlotTestRuntime.renderSlot`）
- [x] `ResearchView` 双 Tab：对话 / 轨迹；运行中按 DSH 事件数刷新
- [x] `ResearchConversationTab` 承载 report / 提案 / 来源

### Phase 9d — 恢复（完成）

- [x] `research_resume_session`：截断 DSH 事件前缀 + `derive_openai_messages` 续跑
- [x] `research_dsh_derive_messages` / `research_dsh_default_boundary`
- [x] `session/end-seed` 标记恢复边界
- [x] Trajectory 底栏「从此处恢复」接 Rust 命令

### Phase 9e — 分叉与子 Agent（完成）

- [x] `research_fork_session`：按边界 seq 复制 DSH 事件前缀到新 workspace + `research.db` 记录
- [x] `completed_turn_prefix` 对齐 `dsh-subagent-fork-in-process` 种子语义
- [x] 子 Agent 写入独立 `.dsh-session/children/<id>/session.jsonl` + `subagent/descriptor`
- [x] 轨迹底栏「分叉为新任务」；`Session.create` 辅助 `forkSessionFromSnapshot`

### Phase 9f — Compaction（完成）

- [x] 加载 `@deepseek-ai/dsh-compaction`（Webview 类型 + Trajectory 识别 `compaction/*`）
- [x] `research_dsh_surface`：surface fold + tool-pairing 边界
- [x] `research_dsh_compact`：全深度 token 压力策略（threshold 0.8 / 多轮 0.65 / retain 0.16）；0.2.23 起取消 deep 专属门控
- [x] ReAct 循环每轮前自动压缩；写入 `compaction/*` + checkpoint `user/message` replace
- [x] `derive_openai_messages` 尊重 surface replace（与 `Session.deriveMessages` 对齐）

---

## 8. Phase 12 — LLM 内置联网检索（0.2.21）

> **编号说明**：Phase 10 = 多轮追问（0.2.17）；Phase 11 = 报告详度（计划）。本节为 **Phase 12**。  
> 状态：**12a 已上线**（`llm_web_search`）；12b DDG 兜底仍为可选后续。

### 8.1 目标

在 arXiv / OpenAlex 学术元数据之外，覆盖 **博客、新闻、技术综述、行业动态** 等通用网页。采用 **「LLM 内置联网 → 登记来源」** 主路径，复用用户已配置的调研 LLM Key，**无需另配 Tavily/Serper**。

**硬约束**：`enable_search` / 平台 `web_search` 与 ReAct 自定义 `tools` **不能同一次请求并存**；因此封装为独立工具 `llm_web_search(query)`，内部发起**无 function tools** 的 LLM 联网请求。

### 8.2 工具矩阵（当前）

| 工具 | 语义 | 状态 |
|------|------|------|
| `search_web` | 学术元数据（OpenAlex / Crossref / GitHub） | 已有 |
| `search_arxiv` | arXiv 官方 API | 已有 |
| `llm_web_search` | **调研 LLM 内置联网**（博客/新闻/综述） | **0.2.21** |
| `fetch_url` | 已知 URL 精读 | 已有 |
| `search_web_pages` | DDG/SearXNG 零 Key SERP | 可选后续（12c） |

### 8.3 多提供商鲁棒性

设置项 `llmNativeWebSearch`：

| 值 | 行为 |
|----|------|
| `auto`（默认） | 按 `baseUrl` 检测；失败时依次尝试 DashScope → 智谱 → OpenAI Responses |
| `dashscope` | `enable_search` + `search_options`（百炼/Qwen） |
| `zhipu` | `tools: [{type:web_search}]`（智谱 GLM） |
| `openai_responses` | `/responses` + `web_search` 工具 |
| `off` | 不注册 `llm_web_search` |

检测规则（`auto`）：`bigmodel.cn` → 智谱；`openai.com` → Responses；`dashscope`/`aliyuncs` → 百炼；其余默认百炼兼容格式。

子 Agent：`research_subtopic` 派生的子 Agent 对博客/综述类子问题**优先** `llm_web_search`，学术类仍用 `search_arxiv` / `search_web`。

### 8.4 费用（用户自备 LLM Key）

- 模型 token：按所选模型标准价（如 qwen3.5-flash 输入 0.2 元/百万 token）
- 百炼联网搜索策略费：turbo 3 元/千次、agent 约 4 元/千次（详见百炼文档）
- 单次调研若调用 5～10 次 `llm_web_search`，联网附加费通常 **&lt; 0.2 元**

### 8.5 实现切片

- [x] **12a** `research_llm_web.rs` + `llm_web_search` 工具
- [x] **12a′** 设置项 `llmNativeWebSearch` + UI 下拉
- [x] **12a″** 子 Agent prompt 优先联网综述
- [x] **12b** ReAct 系统提示区分学术 vs 通用网页
- [ ] **12c**（可选）`search_web_pages` DDG 兜底（`llmNativeWebSearch=off` 且需零 Key 时）
- [ ] **12f**（并行）OpenAlex 用户自备 Key

### 8.6 边界与降级

- `llm_web_search` 失败：observation 提示改用 `search_web` / `search_arxiv` / `fetch_url`
- 模型不支持联网：设置选 `off`，或换支持联网的模型/端点
- 来源解析失败时仍返回 LLM 综述文本；百炼 OpenAI 兼容模式常不返回 `search_info`，此时：① 回退 DashScope 原生 API 取 `search_info`；② 从综述中的 `arXiv:` / URL /「标题 | URL」/ 来源列表 bullet 提取；③ 具名来源经 DDG Lite 补链；④ 仍无条目则登记 1 条综述备忘来源

---

## 9. Phase 14 — 上下文用量圆环（0.2.24）✅

> Phase 11 已落地 DSH 自动压缩；本节为**可视化层**，1:1 对齐 Cursor 3.3+ Context Usage 圆环与托盘。详见 [deep-literature-research-assessment.md §Phase 14](deep-literature-research-assessment.md#phase-14--上下文用量圆环024计划)。

### 9.1 目标

追问 composer 旁展示上下文占用圆环；单击展开分项托盘（system / tools / compacted / conversation / draft），配色用 PaperNest CSS 变量适配亮/暗主题。

### 9.2 实现切片

- [x] **14a** `research_context_usage.rs` + Tauri command + 单元测试
- [x] **14b** `ResearchContextRing`（SVG dash 圆环，hint 与发送钮之间）
- [x] **14c** `ResearchContextPanel`（composer 上方托盘：堆叠色条 + 分项列表）
- [x] **14d** `ResearchComposer` / `ResearchConversationTab` 接入；draft debounce 300ms
- [x] **14e** 暗主题走查；CHANGELOG 0.2.24

### 9.3 边界

- 固定 128k 窗口（`CompactionPolicy::deep().context_window`）；G2 可配置 `contextWindow` 延后。
- 仅 `canFollowUp` 场景显示；新建任务卡片二期。
- 统计与 `derive_openai_messages` 同源，不读 API `usage`。

---

## 10. Phase 13 — 外网 SERP 兜底（可选，未启动）

> 原 Phase 12 中 DDG Lite / SearXNG 方案顺延至此，仅在用户关闭 LLM 内置联网且需零 Key 通用搜索时实现。

### 9.1 参考架构（零 Key）

```text
search_web_pages(query)
  → DuckDuckGo Lite（HTML 解析，无 Key）
  → 可选 SearXNG 实例
  → 可选用户自备 Tavily / Serper / Brave Key
```

---

## 10. 原 Phase 12 外网通用检索（已修订，见上）

以下为 0.2.20 前规划存档，**默认路径已改为 llm_web_search**：

### 8.1 目标（存档）

在 arXiv 与本地库之外，覆盖 **技术博客、官方文档、技术报告落地页、GitHub README** 等通用网页；Agent 采用 **「通用搜索 → 读页摘要」** 两层架构。

**分发约束（硬要求）**：软件交付给他人使用时，**不得内置或默认使用开发者的任何 API Key**。默认路径必须 **零注册、零 Key、开箱可用**；商业搜索 API 仅作为用户**自行注册后**的可选增强。

### 8.2 外网 API 矩阵（存档）

| 工具 / 数据源 | 端点 | 认证 | 费用 | 默认行为 |
|---------------|------|------|------|----------|
| `search_arxiv` | `export.arxiv.org/api/query` | 无 | 免费（约 3s/请求） | 已上线 |
| `search_web` → OpenAlex | `api.openalex.org` | 免费 Key（2026 起建议） | 免费额度 + 超额付费 | 已上线，**无内置 Key** |
| `search_web` → Crossref | `api.crossref.org` | 礼貌池 `mailto:` | 免费 | 已上线 |
| `search_web` → GitHub | `api.github.com` | 可选 PAT | 匿名约 10 次/分钟 | 已上线 |
| `search_web_pages`（13） | **DuckDuckGo Lite**（默认） | **无** | 免费 | **可选后续** |
| `search_web_pages`（13 可选） | **SearXNG** 实例 URL | 无 Key，仅实例地址 | 免费（实例可用性自负） | 用户自填 `searxng_base_url` |
| `search_web_pages`（13 可选） | Tavily / Serper / Brave | **用户自备 Key** | 有免费试用档，量产付费 | **不设默认，不内置 Key** |
| `fetch_url` | 直连 HTTP + HTML 剥标签 | 无 | 免费 | **0.2.17 已上线** |
| `llm_web_search` | 调研 LLM 内置联网 | 复用调研 LLM Key | 按模型+搜索策略 | **0.2.21 默认** |

命名区分：

| 工具 | 语义 |
|------|------|
| `search_web` | **学术元数据**（OpenAlex / Crossref / GitHub） |
| `llm_web_search` | **通用网页**（LLM 内置联网，0.2.21） |
| `search_web_pages` | **通用网页 SERP**（DDG 等，可选后续） |

### 8.3 参考架构（零 Key 默认）（存档，已非默认路径）

```text
search_web_pages(query)                    # 13，allow_web_search 时注册
  → 默认：DuckDuckGo Lite（HTML 解析，无 Key）
  → 可选：用户配置的 SearXNG 实例（仅 base URL，无 Key）
  → 可选：用户自备 Tavily / Serper / Brave Key（设置页显式启用）
  → 返回 [{ url, title, snippet }]

fetch_url(url)                             # 0.2.17 已有；12b 仅增强
  → 默认：直连 HTTP + strip_html（零 Key）
  → 失败不终止 run；JS 重站可能无正文
```

与现有工具关系：

| 工具 | 职责 | 状态 |
|------|------|------|
| `search_library` | 本地 FTS + LIKE | 已有 |
| `search_arxiv` | arXiv 官方 API | 已有 |
| `search_web` | OpenAlex / Crossref / GitHub | 已有 |
| `llm_web_search` | LLM 内置通用网页 | **0.2.21** |
| `search_web_pages` | 通用网页搜索 | **13 可选** |
| `fetch_url` | 单页精读 | **已有** |

### 8.4 默认提供商：DuckDuckGo Lite（存档）

选用理由（对照 GPT Researcher / OpenClaw 等）：

1. **无 API Key、无账号** — 符合「交给他人使用不携带开发者凭证」
2. **实现简单** — Rust 侧复用现有 `http_client` + HTML 解析，不引入 Chrome/CDP 依赖
3. **与学术层互补** — `search_web` 覆盖论文元数据；`search_web_pages` 覆盖落地页与博客

已知限制（写入 observation，不掩盖）：

- 非官方 API，页面结构变更可能导致解析失败
- 偶发 bot challenge；失败时 observation 提示 Agent 改用 `search_web` / `search_arxiv` / 用户消息中的链接 + `fetch_url`
- 不适合高频批量检索；ReAct 内限制单次 `limit`（建议 ≤8）

备选 **SearXNG**：设置项 `searxng_base_url`（如 `https://searx.example.org`），调用 `GET /search?q=…&format=json`。不自建、不托管公共实例列表；用户自行填写可用实例。

**明确不做**：在源码、构建脚本或默认配置中写入 Tavily/Serper/Brave/OpenAlex 的开发者 Key。

### 8.5 实现切片（存档）

- [ ] **13a** `research_web_pages.rs`：`search_web_pages` 工具；默认 `web_search_provider=ddg`（DuckDuckGo Lite）
- [ ] **13a′** 设置项（可选增强）：`web_search_provider`（`ddg` \| `searxng` \| `tavily` \| `serper`）、`searxng_base_url`、`web_search_api_key`（仅后两者需要；加密存 research.db，**默认空**）
- [ ] **13b** `fetch_url` 增强（低优先级）：改进 `strip_html` / 标题提取；**不**默认接 Jina（需 Key 或 IP 限额，与分发约束冲突）
- [ ] **13c** ReAct 系统提示：博客/文档类问题先 `search_web_pages`，再 `fetch_url`；学术类继续 `search_web` / `search_arxiv`；禁止编造 URL
- [ ] **13d** 设置 UI：外网区块说明「默认免费、无需 Key」；商业提供商与 Key 折叠在「可选增强」
- [ ] **13e** 轨迹：`tool/result` 与现有 DSH 事件一致
- [ ] **13f**（并行补丁）OpenAlex：设置项 `openalex_api_key`（用户自备免费 Key），**不内置**；无 Key 时保持当前低配额行为

### 8.6 边界与降级（存档）

- 默认 `ddg`：**无需任何 Key** 即可 `search_web_pages`
- `ddg` / `searxng` 失败：返回明确 observation + 建议 `search_web` / `search_arxiv` / `fetch_url`（用户已给链接时）
- 未配置 `web_search_api_key` 时选择 `tavily`/`serper`：拒绝调用并提示用户在设置页填写**自己的** Key
- `fetch_url` 失败不终止调研 run（与 `get_paper` 软错误一致）
- 不在 Rust 内嵌无头浏览器；读页优先只读 HTTP + 正文提取

---

## 9. 验收标准

1. 调研完成后，`.dsh-session/*.jsonl.zstd` 可用官方 persistence 工具独立打开；`deriveMessages()` 与运行时 LLM 请求一致。
2. Trajectory Tab 使用 **`@deepseek-ai/dsh-client-ui-trajectory` 未改样式源码**；视觉与 DSH Web UI 1:1。
3. 任意 `tool/result` 在 Inspector Result 中为完整 observation（与写入模型字符串相同）。
4. `SessionStore.fork` 产生子 session，事件前缀与父 session 一致；PaperNest `research.db` 新记录指向新 workspace。
5. 无自研 `ResearchEvent` 类型；事件类型均为 DSH `SessionEventMap` 成员或官方插件 merge 类型。
6. `npm run check` + `cargo test` 通过。

---

## 10. 风险与对策

| 风险 | 对策 |
|------|------|
| Rust↔JS append 延迟 | 批量 append API；调研循环 await bridge |
| Cordis 与 Tauri 生命周期 | `ResearchHarnessProvider` 单例；调研页卸载时 `session/flush` |
| DSH API 预览期变动 | pin 版本；升级时跑官方 invariant 测试 |
| npm 包未发布 | submodule 引用 monorepo 同路径包 |
| 双写 steps/ 漂移 | 9b 后 steps 仅投影或废弃 |

---

## 11. 参考

- [DSH Harness 官网](https://deepseek.com/harness/en/)
- [dsh-session](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/session)
- [dsh-session-persistence-jsonl](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/session/session-persistence-jsonl)
- [dsh-client-ui-trajectory](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-trajectory)
- [Session 子系统文档](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)
- [PaperNest ReAct 方案](research-react-upgrade-plan.md)
- [深度调研定稿](deep-literature-research-assessment.md)
