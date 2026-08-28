# 文献调研 Trajectory 轨迹方案（Phase 9）

> 版本：0.2.16 规划；状态：待实施  
> 前置：Phase 7 ReAct + Phase 7e Reviewer + Phase 8 子 Agent（0.2.15）  
> 策略：**复用 DeepSeek Harness 官方包**，不自研事件 schema / derive / Trajectory UI  
> 上游：[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（MIT）

---

## 1. 目标

文献调研接入 DSH 事件溯源体系，Trajectory 视图 **直接嵌入官方 `TrajectoryView`**，外观与交互与 DSH 1:1 一致；业务内容适配 PaperNest（ReAct、Reviewer、子 Agent、Writer、`sources.jsonl` / `report.md`）。

核心不变量（来自 DSH，不自行改写）：

1. **Model-visible means recorded** — 见 [dsh-session README](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/core/session/README.md)
2. **`Session` 仅追加日志为唯一真相** — `deriveMessages()` 派生 LLM 历史，禁止旁路维护 `messages[]`
3. **恢复、分叉、检索、回放** — 共用同一份持久化事件流（`SessionStore.fork` + persistence 插件）

---

## 2. 复用边界：用什么、不写什么

### 2.1 直接复用（npm / 源码）

| 官方包 | 职责 | PaperNest 用法 |
|--------|------|----------------|
| `@deepseek-ai/dsh-session` | `Session`、`SessionStore`、`append`、`deriveMessages`、`fork` | 调研会话真相来源 |
| `@deepseek-ai/dsh-session-persistence-jsonl` | 工作区 JSONL（默认 `.jsonl.zstd`）持久化 | `research/<id>/.dsh-session/` |
| `@deepseek-ai/dsh-session-checkpoint-policy` | 崩溃恢复 checkpoint | 与 persistence 一并加载 |
| `@deepseek-ai/dsh-client-ui-trajectory` | `TrajectoryView`、热图、`TrajectoryTable`、Inspector | **轨迹 Tab 整页嵌入，不手写 UI** |
| `@deepseek-ai/dsh-client-ui-conversation` | 对话 / 轨迹双 Tab 壳层 | 包裹 Trajectory + PaperNest 对话内容 |
| `@deepseek-ai/dsh-client-ui-primitives` | 徽章、代码块、虚拟列表原子组件 | Trajectory 依赖，随包引入 |
| `@deepseek-ai/dsh-subagent-fork-in-process` | 子 Agent 进程内分叉 | 对接 `research_subtopic` |
| `@deepseek-ai/dsh-compaction`（可选 9f） | 长会话压缩 | deep 模式启用 |

参考实现：`packages/client/ui-trajectory`、`examples/agent-spine-demo`、`packages/core/session`。

### 2.2 保留在 Rust（PaperNest 领域）

| 模块 | 原因 |
|------|------|
| `research_tools` | 本地 FTS、arXiv、批注检索；已有 MCP 共用 |
| `research_react` / `reviewer` / `writer` / `subagent` 编排 | 与 `library.db`、工作区文件强绑定 |
| `sources.jsonl`、`report.md`、`proposals/` | 产品交付物契约 |

### 2.3 明确不实现（避免与 DSH 漂移）

- ~~自研 `research_trajectory.rs` + 自定义 `derive_messages`~~
- ~~自研 `trajectory.jsonl` 信封格式~~
- ~~自研 `ResearchTrajectoryView` / `trajectoryTheme.css` / 徽章色值表~~
- ~~Rust 侧 fork / replay 逻辑~~ → 调用 JS `SessionStore.fork` 或 persistence `load`

---

## 3. 架构：Rust 编排 + DSH Session 桥接

PaperNest 是 Tauri（Rust 领域层 + React 表现层）。DSH 是 TypeScript + Cordis 插件。采用 **Harness Bridge**：领域工具留在 Rust，**会话日志与 Trajectory UI 完全走 DSH 栈**。

```text
┌─ React（Webview）──────────────────────────────────────────────────┐
│  @deepseek-ai/dsh-client-ui-conversation   ← 对话/轨迹 Tab          │
│  @deepseek-ai/dsh-client-ui-trajectory    ← TrajectoryView 原组件   │
│  src/research-harness/                                              │
│    bootstrap.ts      Cordis ctx + session + persistence 插件        │
│    sessionBridge.ts  供 Tauri invoke 的 append / fork / load          │
│  ResearchView.tsx    对话 Tab = report / proposals / sources        │
└───────────────────────────────┬────────────────────────────────────┘
                                │ Tauri invoke（事件追加、会话 id）
┌─ Rust ────────────────────────┴────────────────────────────────────┐
│  research_react / reviewer / writer / subagent                      │
│    每步：dsh_append(type, data, surfaceOp)  → 转发 Webview Bridge   │
│    LLM 前：deriveMessages 由 Bridge 返回（或 Rust 只发请求、JS 记日志）│
│  research_tools::execute_*   不变                                    │
└────────────────────────────────────────────────────────────────────┘
         │
         ▼
research/<session-id>/.dsh-session/<sessionId>.jsonl.zstd   ← 官方持久化格式
research/<session-id>/sources.jsonl | report.md | steps/    ← 产品层不变
```

### 3.1 工作区目录

```text
research/<session-id>/
  .dsh-session/              # persistence-jsonl 的 root（官方要求显式 root，不用 cwd）
    <dshSessionId>.jsonl.zstd
  manifest.json              # PaperNest 索引；含 dshSessionId 映射
  sources.jsonl
  report.md
  outline.md
  steps/                     # 可选：从 DSH 事件投影，兼容旧浏览习惯
  proposals/
```

`steps/` 由 DSH 事件投影生成，或逐步废弃；**审计与 Trajectory 以 `.dsh-session` 为准**。

### 3.2 事件词汇：使用 DSH `SessionEventMap`

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

### Phase 9a — Harness 引导与持久化

- [ ] 新增 `src/research-harness/bootstrap.ts`，加载 session + persistence-jsonl + checkpoint
- [ ] 工作区 `.dsh-session/` 目录；`manifest.dshSessionId`
- [ ] `ResearchHarnessProvider` 在 `ResearchView` 挂载
- [ ] 验证：空 session `append` + 落盘 + `load` 回放

### Phase 9b — Rust ↔ DSH 桥接

- [ ] `research_dsh_append` / `research_dsh_derive_messages` Tauri 命令
- [ ] `research_react`：每轮 `turn/step` 边界 + `tool/call` + `tool/result` + `assistant/message`
- [ ] `request/header` 记录 system prompt 与 tools schema
- [ ] 取消 `steps/` 内 observation 截断；投影可选

### Phase 9c — 官方 Trajectory UI

- [ ] 嵌入 `TrajectoryView` + conversation 双 Tab
- [ ] 绑定 `dshSessionId`；运行中 `session/event` 实时更新
- [ ] 与 DSH 截图对比验收（布局、徽章、Inspector、热图）

### Phase 9d — 恢复

- [ ] `research_resume_session`：`seed` 加载事件前缀 + Rust 从 `deriveMessages` 续跑
- [ ] Trajectory 底栏 Resume 接 Rust 命令

### Phase 9e — 分叉与子 Agent

- [ ] `SessionStore.fork` + 新调研 workspace
- [ ] 接入 `dsh-subagent-fork-in-process` 替换手写 `run_subtopics` 日志

### Phase 9f — Compaction

- [ ] 加载 `@deepseek-ai/dsh-compaction`；deep 模式配置策略

---

## 8. 验收标准

1. 调研完成后，`.dsh-session/*.jsonl.zstd` 可用官方 persistence 工具独立打开；`deriveMessages()` 与运行时 LLM 请求一致。
2. Trajectory Tab 使用 **`@deepseek-ai/dsh-client-ui-trajectory` 未改样式源码**；视觉与 DSH Web UI 1:1。
3. 任意 `tool/result` 在 Inspector Result 中为完整 observation（与写入模型字符串相同）。
4. `SessionStore.fork` 产生子 session，事件前缀与父 session 一致；PaperNest `research.db` 新记录指向新 workspace。
5. 无自研 `ResearchEvent` 类型；事件类型均为 DSH `SessionEventMap` 成员或官方插件 merge 类型。
6. `npm run check` + `cargo test` 通过。

---

## 9. 风险与对策

| 风险 | 对策 |
|------|------|
| Rust↔JS append 延迟 | 批量 append API；调研循环 await bridge |
| Cordis 与 Tauri 生命周期 | `ResearchHarnessProvider` 单例；调研页卸载时 `session/flush` |
| DSH API 预览期变动 | pin 版本；升级时跑官方 invariant 测试 |
| npm 包未发布 | submodule 引用 monorepo 同路径包 |
| 双写 steps/ 漂移 | 9b 后 steps 仅投影或废弃 |

---

## 10. 参考

- [DSH Harness 官网](https://deepseek.com/harness/en/)
- [dsh-session](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/core/session)
- [dsh-session-persistence-jsonl](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/session/session-persistence-jsonl)
- [dsh-client-ui-trajectory](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/client/ui-trajectory)
- [Session 子系统文档](https://deepseek-harness.github.io/deepseek-harness/en/reference/subsystems/session)
- [PaperNest ReAct 方案](research-react-upgrade-plan.md)
- [深度调研定稿](deep-literature-research-assessment.md)
