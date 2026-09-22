# 导入自动分类改为 Jev

> 方案日期：2026-09-19。对照 [TypeSafe API](https://docs.typesafe.ai/api.md)、[Primitives](https://docs.typesafe.ai/primitives.md)、[Choice](https://docs.typesafe.ai/primitives/choice.md)。现状见 [llm-taxonomy-classification-v1.md](llm-taxonomy-classification-v1.md)（0.1.83 已落地）。
>
> **实施状态：未开始。** 当前 `classify_paper_taxonomy` 仍走 OpenAI 兼容 `llm_completion`。

## 结论

| 项 | 决定 |
| --- | --- |
| 替换范围 | 只换 `classify_paper_taxonomy`。摘要、术语、翻译、雷达解读、阅读台解读、调研仍用现有 Chat Completions |
| 调用形态 | 一次 `POST /v1/systemone`。主领域 1 个 Choice；每个子领域标签 1 个 Choice。同一 state，并行、互不看见对方答案 |
| 词表 | 仍只读库内 `categories` / `tags`。不新建标签 |
| 弃权 | 主领域 Choice 增加选项 `none`。选中 `none` 则 `abstain=true`，标签清空 |
| 严格度 | 仍在代码里过滤，不写进问题。strict 只留 `central` 且 ≤3；standard ≤4；relaxed ≤6。排序先 central 后 substantial |
| 写入 | 不变：`mergeTaxonomyIntoPaper` 只填尚无 `categoryId` 且 `tagIds` 为空的论文 |
| 密钥 | 独立 Credential `PaperNest` / `jev_api_key`。不复用 Chat LLM 的 Key，也不把分类退回 Chat LLM |
| 模型 | 常量 `jev-latest`，端点 `https://api.typesafe.ai/v1/systemone`。不增加 Base URL 或模型名设置项 |
| 置信度门槛 | 本阶段按返回的 `choice`（概率最大项）行事。响应里的 `confidence` 不参与过滤，也不进导入提示 |

一句话：分类从「生成 JSON 再白名单清洗」改成「封闭选项上的一次并行决策」；导入按钮、严格度和写回规则不动。

## 1. 为什么是这次请求形状

官方约束（2026-09-19 文档）：

- 端点 `POST https://api.typesafe.ai/v1/systemone`，`Authorization: Bearer <API_KEY>`。
- 问题类型只有 Choice / Score / Noul。Choice 从你给的选项里选一个，返回 `choice`、`probabilities`、`confidence`。选项 1～255 个。选项名和说明都会送给模型；问题 id 不送给模型。
- 同一请求里的问题互相独立，并行计算。后一个问题不能用前一个答案当上下文。选项不依赖前一个答案时，不要拆成两次请求。
- 列表可能盖不住输入时，加 `none` / `other`，避免模型硬选最接近的错项。
- state 与 questions 共享约 32K token。默认约 16 个主领域、31 个标签，远低于上限。
- 错误：401 密钥无效，422 请求不合法，429 / 529 需退避重试。

本库分类与这些约束的对应：

- 主领域恰好是单选，用 Choice，并加 `none`。不再另问一个弃权 Noul，避免两个独立答案互相打架。
- 标签是多选，且带 `central` / `substantial`。每个标签一个三选一 Choice：`skip` / `substantial` / `central`。不用 Noul（会丢掉两档相关度），不用 Score（分数会落在档位之间）。
- 标签与主领域在库里没有父子外键，标签全集不依赖主领域答案，所以放在同一次请求里。
- `reason` 是一句中文说明。Jev 不生成文字。导入提示已经用领域名和标签名拼文案（`formatTaxonomyImportNote`），不读 `reason`。成功时 `reason` 留空；弃权时写现有固定句「未匹配现有主领域，保持未分类」。

## 2. 请求与映射

### 2.1 state

```json
{
  "title_en": "…",
  "title_zh": "…",
  "abstract_en": "…",
  "abstract_zh": "…",
  "summary": "…"
}
```

缺的字段省略。instructions 用反引号路径指到 `title_en`、`abstract_en`、`summary`（官方要求）。说明和选项描述用英文，并带上库里的中文名，以便对照中文摘要。

### 2.2 问题

主领域（问题 id `category`，模型看不见这个 id）：

```json
{
  "type": "choice",
  "instructions": "Which single main field covers the core contribution of this paper, using `title_en`, `abstract_en`, and `summary`? If none does, choose none.",
  "criteria": {
    "cat-cv": "计算机视觉. Computer vision.",
    "none": "No listed field reasonably covers this paper."
  }
}
```

每个标签（问题 id `tag__{tagId}`，例如 `tag__tag-llm`）：

```json
{
  "type": "choice",
  "instructions": "How central is \"大语言模型\" (large language models) to this paper's own contribution, using `title_en`, `abstract_en`, and `summary`? Ignore mentions that appear only in related work.",
  "criteria": {
    "skip": "Not part of the core contribution or a substantial dependency.",
    "substantial": "Methods, experiments, or the problem setup substantially depend on it, but it is not the sole topic.",
    "central": "The core contribution or main object of study is this subdomain."
  }
}
```

`criteria` 的 key 用库内 id（主领域）或固定档位名（标签），保证答案能原样映射。种子词表的英文附在描述里，写死在 Rust 常量，不改 `categories` / `tags` 表。用户后加的词条没有英文时，描述只用 `name`。

主领域选项数含 `none` 超过 255 时，命令直接返回错误，不发请求。

### 2.3 答案 → 现有 `LlmTaxonomyRaw`

先映射，再走现有 `validate_taxonomy`（非法 id 丢弃、严格度、上限、弃权清空标签）：

| Jev | `LlmTaxonomyRaw` |
| --- | --- |
| `answers.category.choice == "none"` 或该字段缺失 | `abstain=true`，`categoryId=null`，`tags=[]` |
| 否则 | `categoryId=choice`，`abstain=false` |
| 某标签 `choice` 为 `central` 或 `substantial` | `tags` 追加 `{ id, relevance }` |
| `skip` 或其他值 | 不加入 |

`validate_taxonomy` 的单测继续覆盖严格度。新增单测只覆盖「Jev JSON → Raw」这一层，用夹具，不打网络。

## 3. 设置与密钥

`LlmSettings` 增加 `jevApiKeySaved: bool`（默认 false）。Key 只进 Windows Credential Manager，条目名 `jev_api_key`，不进 SQLite、备份和前端状态。

设置页「导入时自动分类」复选框下增加密码框和「测试 Jev」。测试先保存当前设置，再发一条 Noul（`state` 固定短句，`instructions` 为 `Does this text mention a paper?`），HTTP 200 即通过。Chat Completions 的「测试连接」不改。

未保存 Jev Key 时，`classify_paper_taxonomy` 不发请求，返回 `abstain=true`，`reason` 为「未配置 Jev API Key」。导入不中断，与今天分类失败不阻断导入一致。

401 把错误原文返回给导入提示。429 与 529 各重试一次，间隔 1 秒，第二次仍失败则把状态码返回。超时 30 秒。

## 4. 不改的调用点

- `LlmTopbar` 与 `runRadarImportLlmFill` 继续在整理之后调用 `backend.classifyPaperTaxonomy`。
- `mergeTaxonomyIntoPaper`、`formatTaxonomyImportNote`、严格度三档文案不变。
- 浏览器预览仍返回「浏览器预览模式不支持自动分类」。
- `analyze_paper_with_llm` 及之后的生成调用不读 Jev Key。

## 5. 实施清单

### 5.1 映射与单测（不联网）

- [ ] 在 `src-tauri` 增加 Jev 请求构造：state、主领域 Choice（含 `none`）、每标签 Choice
- [ ] 种子 id → 英文短名常量；无常量时描述只用中文 `name`
- [ ] `jev_answers_to_raw`：按 §2.3 映射
- [ ] 单测：`none` → 弃权且标签空；`central`/`substantial`/`skip` 映射正确；主领域选项数 >255 时构造函数失败
- [ ] 现有 `validate_taxonomy` 测试保持通过

### 5.2 替换命令内部

- [ ] `classify_paper_taxonomy` 改为读 `jev_api_key` 并 `POST /v1/systemone`，模型 `jev-latest`
- [ ] 删掉本命令对 `taxonomy_system_prompt`、`build_taxonomy_user_message`、`llm_completion` 的调用。这两个拼 prompt 的函数若再无引用则删除
- [ ] 元数据过短、主领域列表为空：保持现有本地短路，不发请求
- [ ] 无 Key：本地弃权，reason「未配置 Jev API Key」
- [ ] 401 返回密钥错误；429/529 重试一次；超时 30 秒

### 5.3 设置

- [ ] `LlmSettings` / `types.ts` / `seed.ts` 增加 `jevApiKeySaved`
- [ ] `save_llm_settings` 接受可选 `jevApiKey`，写入 Credential `jev_api_key`；空字符串不覆盖已存密钥（与现有 LLM Key 相同）
- [ ] `LlmSettingsForm`：Jev Key 输入框 +「测试 Jev」
- [ ] `test_jev_connection`：先要求设置已写入，再发一条 Noul

### 5.4 文档

- [ ] `docs/DEVELOPMENT.md` §3.2：自动分类改为 Jev systemone；Chat LLM 仍负责整理
- [ ] `docs/CHANGELOG.md` 记一笔：分类不再走 Chat Completions

### 5.5 验收

- [ ] `cargo test` 中 taxonomy / jev 映射用例通过
- [ ] 前端 `taxonomyClassify` 相关 vitest 通过
- [ ] 桌面端：填入 Jev Key，测试连接成功；导入一篇已知 CS 论文，主领域落在词表内；导入一篇明显非 CS 文本，保持未分类
- [ ] 关闭「自动分类」或清空 Jev Key 后导入，不发 systemone，摘要整理仍走原 LLM
