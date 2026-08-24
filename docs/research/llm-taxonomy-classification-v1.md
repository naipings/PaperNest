# 导入 PDF 时 LLM 自动分类（V1）

> 方案日期：2026-08-24；**已实现于 0.1.83**。参考 [zotero-semantic-tagger](https://github.com/roey-angel/zotero-semantic-tagger)、[zotero-llm-classify](https://github.com/Mor-Li/zotero-llm-classify)、[zotero_tag_recommender](https://github.com/kinranlau/zotero_tag_recommender)。

## 结论摘要

| 项 | V1 决策 |
| --- | --- |
| 触发时机 | PDF 导入且 `autoAnalyzeOnImport` + API Key 已配置时，在**现有元数据/摘要/术语分析完成之后**追加一步 |
| 分类方式 | **一步**：同时输出主领域 + 子领域标签 |
| 词表来源 | **仅用户库内** `categories` / `tags`（设置页可增删改）；禁止 LLM 自造名称或 id |
| 主领域 | 0 或 1 个；无法合理匹配 → **弃权**（`categoryId = null`） |
| 子领域 | 0～N 个；**弃权时强制为空**；默认严格度下 N ≤ 3 |
| 严格度 | 默认 **strict**；设置页可选 standard / relaxed |
| 覆盖策略 | 仅当论文**尚无** `categoryId` 且 `tagIds` 为空时写入；用户已分类的不覆盖 |
| 新标签 | V1 **不**自动创建 category/tag；域外论文保持未分类 |

---

## 1. 背景与范围

### 1.1 当前行为

导入 PDF（`LlmTopbar.importPdfs`）在 LLM 开启时调用 `analyze_paper_with_llm`，产出 `LlmAnalysis`（标题、摘要、summary、术语、框架图等），经 `applyAnalysis` 写回论文。**不涉及** `categoryId` / `tagIds`。

分类体系（`src/seed.ts`）：

- **主领域** `Category`：ACM 对齐，约 16 项，每篇最多 1 个
- **子领域** `Tag`：方法/任务/阅读用途，约 30 项，可多选
- 二者在 DB 中**无父子外键**；语义上子标签应与主领域一致，靠 prompt 约束

### 1.2 V1 目标

导入后自动为**能匹配现有词表**的 CS 论文填入主领域与子领域；**不能匹配则弃权**，避免标签膨胀。

### 1.3 V1 不做

- 不自动新建 category/tag
- 不做两阶段（先主后子）独立 API 调用
- 不用 logprob 置信度门槛（留 V2）
- 不做「仅建议、用户点选」UI（留 V2；V1 直接写入，但有弃权与覆盖保护）
- 不改造 Bib/RIS 导入路径（可 V1.1 复用同一 classify 命令）

---

## 2. 总体流程

```text
chooseAndImportPdfs
  → fillFromPdf（封面元数据）
  → analyzeWithFallback（现有 LlmAnalysis）
  → applyAnalysis + 术语/框架图
  → 【新增】classifyPaperTaxonomy
  → applyTaxonomy（条件写入 categoryId / tagIds）
  → savePaper
  → importNotice（含分类结果或弃权说明）
```

**独立 Tauri 命令**，不扩展 `analyze_paper_with_llm` 的 JSON 字段——避免单次 prompt 过长、解析失败牵连摘要/术语、以及职责混杂。

---

## 3. 数据模型（新增类型）

### 3.1 输入 `LlmTaxonomyInput`

```ts
interface LlmTaxonomyInput {
  /** 英文标题 */
  titleEn: string;
  titleZh?: string;
  /** 优先 abstractEn；无则 summary */
  abstractEn?: string;
  abstractZh?: string;
  summary?: string;
}
```

Rust 侧 snake_case + camelCase serde 与现有命令一致。不传 PDF 全文，控制 token；分类所需信息以 title + abstract/summary 为主（与 zotero_tag_recommender 一致）。

### 3.2 输出 `LlmTaxonomyResult`（LLM 原始 + 解析后）

**LLM 应返回的 JSON（模型侧）：**

```json
{
  "categoryId": "cat-nlp",
  "tags": [
    { "id": "tag-llm", "relevance": "central" },
    { "id": "tag-transformer", "relevance": "substantial" }
  ],
  "abstain": false,
  "reason": "论文核心为大语言模型预训练与能力综述，属于 NLP 主领域。"
}
```

**弃权示例：**

```json
{
  "categoryId": null,
  "tags": [],
  "abstain": true,
  "reason": "内容为临床医学 RCT，与现有计算机科学主领域列表均不匹配。"
}
```

**解析 + 校验后的应用结果（内部）：**

```ts
type TaxonomyRelevance = "central" | "substantial" | "peripheral";

interface LlmTaxonomyTagSuggestion {
  id: string;
  relevance: TaxonomyRelevance;
}

interface LlmTaxonomyResult {
  categoryId: string | null;
  tagIds: string[];           // 校验、严格度过滤、去重后的最终 id 列表
  abstain: boolean;
  reason?: string;            // 可选，供导入通知 / 调试
  droppedTagIds?: string[];   // 可选，被白名单或严格度丢弃的 id（调试）
}
```

### 3.3 设置扩展 `LlmSettings`

```ts
type TaxonomyStrictness = "strict" | "standard" | "relaxed";

interface LlmSettings {
  baseUrl: string;
  model: string;
  autoAnalyzeOnImport: boolean;
  visionEnabled: boolean;
  apiKeySaved: boolean;
  /** V1 新增，默认 true：在自动分析后尝试分类 */
  autoClassifyOnImport: boolean;
  /** V1 新增，默认 strict */
  taxonomyStrictness: TaxonomyStrictness;
}
```

`autoClassifyOnImport` 默认 `true`，但仅在 `autoAnalyzeOnImport && apiKeySaved` 时生效；用户可在设置页关闭「导入时自动分类」而保留摘要/术语分析。

### 3.4 严格度与 tag 数量规则

| 严格度 | 允许的 relevance | 硬上限 maxTags | 说明 |
| --- | --- | --- | --- |
| **strict**（默认） | 仅 `central` | 3 | 防标签泛滥；综述类通常 central=综述 + 1～2 方法标签 |
| **standard** | `central` + `substantial` | 4 | 交叉方法论文 |
| **relaxed** | `central` + `substantial` | 6 | 宽口径；仍丢弃 `peripheral` |

**全局规则（代码强制执行，不依赖模型）：**

1. `abstain === true` 或 `categoryId === null` → 最终 `categoryId = null`，`tagIds = []`
2. `tagIds` 去重、顺序保留模型输出顺序
3. 不在 `categories` / `tags` 表内的 id **静默丢弃**（对齐 zotero-semantic-tagger）
4. 超过 maxTags 时**按 relevance 优先级截断**：central > substantial > peripheral，同档保留原顺序

---

## 4. Prompt 草案

### 4.1 System prompt（固定）

```text
你是 PaperNest 的论文分类助手。任务：根据给定论文的标题与摘要（或一句话总结），从用户提供的「主领域」与「子领域标签」词表中选择分类结果。

硬性规则：
1. 你只能使用词表中列出的 id，禁止发明新 id、新名称或同义词替换。
2. 主领域 categoryId：最多 1 个；若没有任何主领域能合理覆盖论文的核心研究方向，必须 abstain=true 且 categoryId=null。
3. 子领域 tags：每个元素为 { "id": "<tagId>", "relevance": "central"|"substantial"|"peripheral" }。
   - central：论文的核心贡献或主要研究对象直接属于该标签。
   - substantial：论文方法/实验/问题设定 substantially 依赖该标签，但不是唯一主题。
   - peripheral：仅在背景、相关工作或个别实验中提及；不要选。
4. 若 abstain=true，则 tags 必须为空数组。
5. 若 abstain=false，则 categoryId 必须非 null，且 tags 中的 id 应在语义上与该主领域一致（词表未硬性绑定，但不得明显矛盾，例如主领域=计算机视觉 却仅选「大语言模型」作 central 而无视觉相关标签）。
6. 不要根据参考文献列表、致谢或作者单位推断标签；仅依据标题与摘要/总结所描述的本文工作。
7. 只返回一个 JSON 对象，字段为：categoryId, tags, abstain, reason。不要 markdown 代码块，不要额外说明。
8. reason 用一句简体中文说明分类或弃权理由（便于用户理解，≤80 字）。

弃权（abstain=true）的典型情况：
- 论文明显不属于计算机科学（如纯医学、法律、人文）。
- 论文过于笼统或信息不足，无法可靠判断主领域。
- 论文属于 CS 边缘方向，但现有主领域列表中没有任何一项算「合理覆盖」（宁缺毋滥）。
```

### 4.2 User message 模板（运行时拼装）

```text
请对下列论文分类。

## 主领域（categoryId，最多选 1 个）
{{#each categories}}
- id: {{id}} | 名称: {{name}}
{{/each}}

## 子领域标签（tags[].id，可多选）
{{#each tags}}
- id: {{id}} | 名称: {{name}}
{{/each}}

## 严格度
当前严格度：{{strictnessLabel}}
{{strictnessHint}}

## 论文信息
标题（英）：{{titleEn}}
标题（中）：{{titleZh}}
英文摘要：{{abstractEn}}
中文摘要：{{abstractZh}}
一句话总结：{{summary}}
```

**`strictnessHint` 填入值：**

| strictness | strictnessLabel | strictnessHint |
| --- | --- | --- |
| strict | 严格 | 只输出 relevance=central 的子领域标签，最多 3 个。 |
| standard | 标准 | 可输出 central 与 substantial，最多 4 个。 |
| relaxed | 宽松 | 可输出 central 与 substantial，最多 6 个。 |

实现时用字符串拼接即可，不必引入模板引擎；上表为逻辑说明。

### 4.3 输入不足时的短路（不调 LLM）

在 Rust 或 TS 边界执行：

```text
若 titleEn 去空白后长度 < 8，且 (abstractEn 与 summary 合计有效字符) < 40：
  → 不调 LLM，直接返回 { abstain: true, categoryId: null, tagIds: [], reason: "元数据不足，跳过自动分类" }
```

---

## 5. 后处理伪代码（`applyTaxonomyDecision`）

```text
输入: raw (LlmTaxonomyResult 原始 JSON), categories[], tags[], strictness

1. 解析 JSON；失败 → 整单弃权，reason="分类 JSON 解析失败"
2. categoryId = raw.categoryId；若在 categories 中不存在 → null
3. 若 raw.abstain || categoryId == null:
     return { categoryId: null, tagIds: [], abstain: true, reason: raw.reason }
4. allowedRelevance = f(strictness)  // 见 §3.4
5. maxTags = f(strictness)
6. tagIds = []
   for t in raw.tags:
     if t.id not in tags catalog: continue
     if t.relevance not in allowedRelevance: continue
     if t.id not in tagIds: tagIds.push(t.id)
     if tagIds.length >= maxTags: break
7. return { categoryId, tagIds, abstain: false, reason: raw.reason }
```

**写入论文（`mergeTaxonomyIntoPaper`）：**

```text
若 paper.categoryId 已有值 → 不修改 categoryId
若 paper.tagIds 非空 → 不修改 tagIds
否则 → paper.categoryId = result.categoryId; paper.tagIds = result.tagIds
```

---

## 6. 导入通知文案

在现有 `importNotice` 的 `notes` 中追加（示例）：

| 情况 | 文案 |
| --- | --- |
| 已分类 | `《Attention…》（主领域：自然语言处理；标签：Transformer、大语言模型）` |
| 弃权 | `《某医学论文》（未匹配现有主领域，保持未分类）` |
| 分类失败 | `《xxx》（自动分类失败：…）` — 不阻断导入，论文保留分析结果 |

---

## 7. 接口与文件变更清单

### 7.1 Rust（`src-tauri/src/lib.rs` 为主）

| 变更 | 说明 |
| --- | --- |
| `struct LlmTaxonomyInput` | 输入序列化 |
| `struct LlmTaxonomyTagRaw` / `struct LlmTaxonomyRaw` | LLM JSON 反序列化 |
| `struct LlmTaxonomyResult` | 命令返回（camelCase） |
| `LlmSettings` 增字段 | `auto_classify_on_import: bool`（默认 true）、`taxonomy_strictness: String`（默认 `"strict"`） |
| `default_llm_settings()` | 补默认值 |
| `load_llm_settings` / `save_llm_settings` | 读写新字段（SQLite `llm_settings` JSON 或现有存储方式） |
| `fn build_taxonomy_system_prompt() -> &'static str` | §4.1 |
| `fn build_taxonomy_user_message(input, categories, tags, strictness) -> String` | §4.2 |
| `fn parse_taxonomy_response(value) -> Result<LlmTaxonomyRaw>` | JSON 解析 |
| `fn validate_taxonomy(raw, categories, tags, strictness) -> LlmTaxonomyResult` | §5 |
| `async fn classify_paper_taxonomy(state, input: LlmTaxonomyInput) -> Result<LlmTaxonomyResult>` | 新 Tauri 命令；内部 `load_llm_settings` + 读 categories/tags + `llm_completion` |
| `invoke_handler![..., classify_paper_taxonomy]` | 注册命令 |

**可选（减少往返）：** 命令内直接从 DB 读 `categories`/`tags`，前端只传 `LlmTaxonomyInput`。词表以服务端为准，避免前端篡改。

### 7.2 TypeScript 类型（`src/types.ts`）

| 变更 | 说明 |
| --- | --- |
| `TaxonomyStrictness` | 类型别名 |
| `LlmTaxonomyInput` / `LlmTaxonomyResult` | 与 Rust 对齐 |
| `LlmSettings` | 增加 `autoClassifyOnImport`、`taxonomyStrictness` |

### 7.3 前端服务（`src/services/backend.ts`）

| 变更 | 说明 |
| --- | --- |
| `classifyPaperTaxonomy(input: LlmTaxonomyInput): Promise<LlmTaxonomyResult>` | `invoke("classify_paper_taxonomy", { input })` |
| 浏览器预览 | 与 `analyzePaper` 相同：`throw new Error("浏览器预览模式不支持…")` 或返回 abstain |

### 7.4 纯函数模块（新建 `src/lib/taxonomyClassify.ts`）

便于单测，Rust 校验逻辑可与此镜像或仅保留 Rust 一层（**推荐校验只在 Rust 做**，TS 模块只负责 `mergeTaxonomyIntoPaper` + 通知文案）：

| 导出 | 说明 |
| --- | --- |
| `mergeTaxonomyIntoPaper(paper, result)` | §5 写入策略 |
| `formatTaxonomyImportNote(paper, result, categories, tags)` | §6 通知片段 |
| `taxonomyInputFromPaper(paper)` | 从 Paper 构造 `LlmTaxonomyInput` |

### 7.5 导入链路（`src/components/LlmTopbar.tsx`）

| 位置 | 变更 |
| --- | --- |
| `analyzeAndFill` | 在 `applyAnalysis` 与 `savePaper` 之间：若 `data.llm.autoClassifyOnImport`，调用 `classifyPaperTaxonomy` → `mergeTaxonomyIntoPaper` |
| `importPdfs` notes | 收集 `formatTaxonomyImportNote` 输出 |
| 失败 catch | 分类失败仅 push note，不 throw（与术语/框架图失败策略一致） |

### 7.6 设置 UI（`src/components/LlmSettingsForm.tsx`）

| 控件 | 说明 |
| --- | --- |
| Checkbox | 「导入时自动分类（主领域与子领域）」→ `autoClassifyOnImport` |
| Select | 严格度：严格 / 标准 / 宽松 → `taxonomyStrictness` |
| 说明文字 | 仅使用设置页现有词表；无法匹配时保持未分类 |

### 7.7 测试（建议新增）

| 文件 | 用例 |
| --- | --- |
| `src/lib/taxonomyClassify.test.ts` | `mergeTaxonomyIntoPaper` 不覆盖已有分类；弃权时 tag 清空；通知文案 |
| `src-tauri/src/lib.rs` `#[cfg(test)]` | `validate_taxonomy`：非法 id 丢弃、strict 仅 central、弃权短路、超 max 截断 |
| `src/components/LlmTopbar.taxonomy.test.tsx`（可选） | mock `classifyPaperTaxonomy`，断言 `savePaper` 带上 categoryId/tagIds |

### 7.8 文档（实现阶段更新）

| 文件 | 内容 |
| --- | --- |
| `docs/CHANGELOG.md` | 新功能条目 |
| `docs/DEVELOPMENT.md` | 导入流水线增加 classify 步骤；LlmSettings 新字段 |
| `README.md` | 导入能力一句话 |

### 7.9 明确不改（V1）

| 文件 | 原因 |
| --- | --- |
| `LlmAnalysis` / `analyze_paper_with_llm` | 职责分离 |
| `schema.sql` | 分类仍用现有 `papers.category_id` / `tag_ids_json` |
| `PaperEditor` | 手动编辑逻辑已满足 |
| `seed.ts` 默认词表 | 除非产品要增 tag；非本功能必需 |

---

## 8. 设置页与词表动态性

运行时 `build_taxonomy_user_message` **必须**使用 `initialize_library` 返回的当前 `categories` / `tags`，而非硬编码 `seed.ts`。用户在设置页新增「强化学习」标签后，下一次导入即可被选。

若词表为空（极端）：

```text
categories.length === 0 → 跳过 classify，reason="未配置主领域"
tags.length === 0 → 允许只填 categoryId，tagIds 恒为 []
```

---

## 9. 验收标准

1. **Transformer 论文**：主领域 `自然语言处理`；子领域含 `Transformer`（central），可选 `入门`（若摘要体现 tutorial 性质则 substantial，strict 下可能不出现）。
2. **YOLO 论文**：主领域 `计算机视觉`；子领域含 `目标检测`。
3. **LLM Survey**：主领域 `自然语言处理`；strict 下 tags 含 `大语言模型`、`综述`（均为 central/substantial 视摘要而定）。
4. **明显非 CS PDF**：abstain，categoryId/tagIds 为空，导入通知说明「未匹配现有主领域」。
5. **LLM 返回伪造 id `cat-fake`**：校验后丢弃，若 category 无效则整单弃权。
6. **用户已手动设 category 的论文再次分析**：不覆盖（V1 导入路径只跑一次；此条防未来「重新分析」功能误伤）。

---

## 10. V2 预留（本文不实现）

- `suggestOnly`：只显示建议，用户确认后应用（tag_recommender 模式）
- logprob 置信度 + 低置信强制弃权
- 两阶段：先主领域再子标签（子集 prompt 更短）
- Bib/RIS 导入后批量 classify
- 详情页「重新自动分类」按钮
- category–tag 显式关联表（DB 层约束子标签候选集）

---

## 11. 实现顺序建议

1. Rust：`LlmTaxonomyResult` + `validate_taxonomy` 单测（可先 mock JSON，不调 API）
2. Rust：`classify_paper_taxonomy` 命令 + prompt 拼装
3. TS：types + backend.invoke + `taxonomyClassify.ts`
4. `LlmTopbar` 接入 + 导入通知
5. `LlmSettings` 字段 + 设置 UI
6. 端到端：导入 3 篇 seed 论文 + 1 篇域外样本

预估改动量：Rust ~120 行，TS ~80 行，测试 ~100 行，文档若干；**不新增 DB migration**。
