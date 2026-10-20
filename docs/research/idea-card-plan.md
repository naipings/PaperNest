# 研究构思实现计划

把 [ResearchStudio-Idea](https://github.com/microsoft/ResearchStudio)（MIT，arXiv:2607.04439）的 IdeaSpark 接到 PaperNest。本轮只做写论文之前的 idea 卡。ResearchStudio-Reel（海报、视频、博客、reel）依赖 Playwright、LibreOffice、FFmpeg 和 Edge TTS，不进入本版。

## 和现有功能的衔接

| 现有功能 | 衔接 |
|----------|------|
| 论文库 | 创建构思时勾选种子论文，标题和摘要写入检索表 |
| 论文精读 | 已关联论文库的精读任务可「据此构思」，预填方向并勾选该论文 |
| 文献调研 | 成稿后「开文献调研」，用卡片正文创建调研会话 |
| 调研 LLM | 不新增 Key。开关、地址、模型和 API Key 用「设置 → 文献调研」 |

## 本版主持的阶段

官方 `run.py next` 质量账本、一致性试跑、公式修补、Phase 4 技术展开和 tectonic PDF 不移植。提示词文件按上游原文放在 `src-tauri/src/idea_skill/`，调用时作为 system 原文，不改写。

宿主把模型读不到的文件按路径内联进 user 消息。全文只检索摘要：`fulltext_cache.json` 的 `source_used` 全部为 `failed`，沿用官方提示词里的降级分支。子模式只有 overview，没有单张 C## 卡；生成阶段允许官方提示词已有的 `sub_pattern=null`。

| 顺序 | 阶段 | 做法 |
|------|------|------|
| 1 | 检索 | arXiv、OpenAlex、Crossref，加上种子论文。写成官方列名的 `lit_table.md` |
| 2 | 瓶颈 | `bottleneck_identify.txt` |
| 3 | 选模式 | `ideate_select.txt` + `overview.md` + `companion-combos.md` |
| 4 | 生成 | `ideate_generate.txt` + 子模式 overview |
| 5 | 撞车 | 用候选的 `signature_terms` 再检索，system 为 scoop-check 的 `SKILL.md` |
| 6 | 审计 | `critique.txt`。一致性门控未跑，不提供 `blocking_findings.json` |
| 7 | 修订 | 审计 `verdict=revise` 时调用 `revise.txt`，宿主按官方 op 合并补丁。`advance` 跳过。`abandon` 仍成稿并写明结论 |
| 8 | 成稿 | 用候选字段排成中文 Markdown。不调用 `derive_plain.txt`，因为该提示词要求 Phase 4 技术展开 |

修订合并只实现 `replace`、`append_sentence`、`append_items`、`swap_sub_pattern`、`rewrite_falsification`。`compute_budget` 拒绝修改。`falsification_prediction` 只允许审计给出 `scope=falsification` 时的 `rewrite_falsification`。不校验模型回显的 `base_candidate_sha256`，宿主没有下发该摘要。

检索年份下界为 2021。连接器失败记入校验说明；一篇都没有时任务失败。已完成阶段落在 `PaperNestLibrary/ideas/<id>/`，继续生成时跳过已有文件。

成稿页脚写明：这是研究提案，不是实验结果；未运行质量门控、公式试跑、Phase 4 和 PDF 渲染；文献只有摘要。
