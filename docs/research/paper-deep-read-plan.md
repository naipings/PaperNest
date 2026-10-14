# 论文精读：实现计划

把一篇或多篇论文 PDF 转为证据驱动的 Markdown 精读报告。每篇论文一个精读任务，报告按 What → Why → How → Experiment → Question 五节串起贡献、动机、技术路线、实验证明链和独立评价；报告完成后可在同一任务内多轮追问。

## 1. 参考实现与复用范围

主参考：[MoonKirito/evidence-grounded-paper-deep-read](https://github.com/MoonKirito/evidence-grounded-paper-deep-read)（MIT）。对照项目：[agent-paper-grounded-reading](https://github.com/c-narcissus/agent-paper-grounded-reading)、[lazy-paper](https://github.com/thematteroftime/lazy-paper)、[paperQA](https://github.com/Joncik91/paperQA)，四者共同做法是「页级/段落级锚点 + 每条结论带证据标记 + 区分作者结论与读者推断」。

| 参考项目组件 | PaperNest 处理 |
|------|------|
| `extract_pdf_text.py`：页 → 段落，全局段落 ID `P0001` | 前端 pdf.js 按行距/换栏切段，Rust 写 `sections.json` 并分配同格式 ID |
| `build_paper_index.py`：章节候选 | 移植 `section_candidates`（同一组章节关键词） |
| `evidence_pack.py`：按阶段关键词打分选段 + 邻段补全 + 预算 | 逐行移植 `build_stage_text_pack` / `estimate_char_budget`，`max_input_chars=120000` |
| `sectioned.py`：五阶段描述、关键词、逐段生成并带前文 | 移植 `REPORT_STAGES` 与阶段提示词；`stages/*.md` 断点续写 |
| `SKILL.md` + `references/*.md` 组合成 skill prompt | 原文移植到 `src-tauri/src/deepread_skill/`，删去 pdffigures2 / 插图条款（见 §2） |
| `validate_report.py`：五节顺序、每节证据锚点、数学定界符、TODO | 移植为 `validate_report`；新增「报告不得含图片」 |
| pdffigures2 + 看图预读 + 全局选图计划 | V1 不做（§2） |

## 2. 与参考项目的差异（已确认）

| 决策 | 内容 | 依据 |
|------|------|------|
| 纯文本证据 | 不提取、不插入图表图片。图表通过图注与正文引用定位，写成 `(Evidence: p. 6, Table 2)`；提示词要求不得声称看过图片 | 参考项目只允许 pdffigures2（需 Java + jar），桌面端不捆绑 |
| LLM | 复用「设置 → 文献调研」的 LLM（流式长输出、自适应超时、Kimi 温度适配） | 五节报告约 4000 字，主 LLM 为非流式短输出 |
| 任务粒度 | 每篇论文一个任务；多选时批量创建、串行运行 | 对应参考项目「每篇独立输出」 |
| 外部 PDF | 存入精读工作区；报告页提供「加入论文库」，入库后任务关联该论文 | 不强制污染论文库 |
| 校验失败 | 报告照常保存，校验问题列在报告顶部 | 参考项目直接报错退出；桌面端保留可读结果并显式展示问题 |

## 3. 数据与文件

`library.db` 新表（`schema.sql`，`CREATE TABLE IF NOT EXISTS`，启动时执行）：

```sql
CREATE TABLE IF NOT EXISTS deep_reads (
  id TEXT PRIMARY KEY,
  paper_id TEXT REFERENCES papers(id) ON DELETE SET NULL,
  source_kind TEXT NOT NULL CHECK(source_kind IN ('library','external')),
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  status TEXT NOT NULL,          -- queued | running | completed | failed | cancelled
  stage TEXT,                    -- 运行中的阶段 key
  error TEXT,
  validation_json TEXT NOT NULL DEFAULT '[]',
  messages_json TEXT NOT NULL DEFAULT '[]',
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

工作区 `PaperNestLibrary/deepread/<id>/`（随资料库备份）：

```text
source.pdf        # 仅外部 PDF
sections.json     # {pages:[{page, paragraphs:[{id:"P0001", text}]}]}
stages/what.md … question.md
report.md
```

## 4. 后端（`src-tauri/src/deepread.rs`）

```text
deepread_create(input)        → 写工作区与 sections.json，插入 queued 任务
deepread_run(id, restart)     → 后台 spawn；全局单许可信号量串行；restart 清空 stages
  for stage in What..Question:
    已有 stages/<key>.md → 跳过（断点续写）
    取消令牌 → cancelled
    证据包 + 章节候选 + 已生成前文 + skill prompt → research_llm_completion_streamed
    finish_reason=length → 失败（输出被截断）
  assemble → report.md；validate_report → validation_json；completed
deepread_cancel / deepread_list / deepread_get / deepread_delete
deepread_ask(id, question)    → 报告全文 + 证据包（问题关键词）+ 最近 12 条 → 追问回答
deepread_delete_turn(id, idx) → 复用 explain::remove_explain_turn
deepread_link_paper(id, paperId) / deepread_open_workspace(id)
启动时 queued/running → failed（「上次运行随应用退出中断，可继续生成」）
```

## 5. 前端

| 部件 | 内容 |
|------|------|
| 侧栏 | 新屏幕「论文精读」（`screen=deepread`），位于「文献调研」之后 |
| 新建精读卡 | 两个来源 Tab。**论文库**：范围选「全部 / 某文件夹 / 知识树邻域」，搜索、多选（无 PDF 的论文不可选，已精读显示标记）；知识树邻域以原点论文按 L1 相似度排序。**本地 PDF**：选择或拖入多个 PDF |
| 任务列表 | 状态：排队 / 生成中（阶段）/ 已完成 / 失败 / 已停止 |
| 报告 Tab | 五阶段进度条；KaTeX 渲染 `$…$` / `$$`；校验问题横幅；复制全文、打开文件夹、阅读台打开（库内）或加入论文库（外部）；停止、继续生成、重新生成 |
| 追问 Tab | 多轮对话（Markdown + 公式），删除单轮；无轨迹视图 |
| 知识树衔接 | 知识树详情栏「论文精读」按钮：跳到精读页并预选该论文，范围切到以它为原点的知识树邻域 |

页文抽取：前端 `src/lib/pdfParagraphs.ts` 用 pdf.js 文本项按行合并，行距大于 1.6 倍行高或换栏时断段，并拼回行尾连字符。库内论文从受管路径读 PDF，外部 PDF 读用户文件后以 base64 交给后端落盘。

新依赖：`remark-math`、`rehype-katex`、`katex`（报告公式渲染）。

## 6. 分步与验收

| 步骤 | 内容 | 验收 |
|------|------|------|
| 1 | 后端模块、表、skill 文本、证据包、阶段提示词、校验、队列、追问 | `cargo test deepread` 覆盖证据包预算/邻段、阶段消息、拼装、校验、删轮 |
| 2 | 前端类型与 backend 封装、段落抽取、精读页、知识树入口、公式渲染 | `vitest` 覆盖段落切分与组件交互；`tsc -b` 通过 |
| 3 | 文档、版本 0.2.50、桌面端实测与打包 | 真实 PDF 生成五节报告且校验通过；追问可用；`npm run tauri build` 产出 exe |
