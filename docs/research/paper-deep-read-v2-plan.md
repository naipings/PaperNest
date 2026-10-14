# 论文精读 V2：插图与对照阅读 实现计划

在 V1（[paper-deep-read-plan.md](paper-deep-read-plan.md)）五节纯文本报告之上增加两项能力：

1. **插图**：报告内嵌论文原图/原表，流程对齐参考项目 [evidence-grounded-paper-deep-read](https://github.com/MoonKirito/evidence-grounded-paper-deep-read)：pdffigures2 提取 → 多模态逐图预读 → 全局选图计划 → 分节写作时按计划插图 → 校验插图来源与覆盖。
2. **对照阅读**：左半屏精读报告，右半屏阅读台原文；点击报告中的证据锚点跳到对应页并高亮对应段落；点击插图跳到原文图表区域；可在多篇精读任务之间切换，右侧随之切换 PDF。

## 1. 已确认决策

| 决策 | 内容 |
|------|------|
| 图表提取 | 打包 [allenai/pdffigures2](https://github.com/allenai/pdffigures2)（Apache-2.0）与精简 Java 运行时，与参考项目一致 |
| 读图 | 多模态逐图预读：图片以 `image_url` 块发给「设置 → 文献调研」的模型；模型不支持图片时接口报错，任务失败并显示错误 |
| 右侧原文 | 复用阅读台 `PdfReader`（可批注）；对照阅读要求任务已关联论文库论文，外部 PDF 先「加入论文库」 |
| 高亮粒度 | 段落级：报告证据锚点 `P0042` / `P0017–P0019` 映射到段落坐标；不改动证据格式 |

现状数据：现有报告 41 处证据锚点全部带段落 ID，段落级跳转可直接落地。

## 2. pdffigures2 运行时

pdffigures2 不在 Maven Central 发布，需本地构建：

```text
scripts/build-pdffigures2.ps1
  下载 Temurin JDK 17 与 sbt 到 %TEMP%（不进仓库）
  克隆 allenai/pdffigures2 固定 commit → sbt assembly → pdffigures2.jar
  jdeps 计算所需模块 → jlink 生成精简运行时
  输出 src-tauri/resources/pdffigures2/{pdffigures2.jar, runtime/, LICENSE-pdffigures2, LICENSE-jdk}
```

- `src-tauri/resources/pdffigures2/` 加入 `.gitignore`，由脚本重建；`tauri.conf.json` 的 `bundle.resources` 引用该目录，缺失时构建失败。
- 后端从 `app.path().resource_dir()` 定位 `runtime/bin/java.exe` 与 jar。便携版 `release/windows/PaperNest.exe` 需与 `pdffigures2/` 目录同级发布。
- 调用参数沿用参考项目：`java -Dsun.java2d.cmm=sun.java2d.cmm.kcms.KcmsServiceProvider -jar pdffigures2.jar <输入目录> -s stats.json -m figures/ -d data/`。
- 预计体积：jar 约 25MB + 运行时约 45MB（未压缩），安装包增加约 30MB。脚本跑通后记录实测值。

## 3. 生成流程（`deepread.rs`）

阶段从 5 个扩为 8 个，全部沿用「已有产物即跳过」的断点续跑；`restart` 清空全部产物。

| 阶段 key | 内容 | 产物 | 移植来源 |
|---------|------|------|---------|
| `figures` | 运行 pdffigures2，页码转为从 1 开始 | `figures/*.png`、`figure_manifest.json`（name、figType、page、caption、image、regionBoundary、captionBoundary） | `pipeline.run_pdffigures2` / `write_figure_manifest` |
| `visuals` | 每张图/表一次多模态调用：图片 + 元数据 + 首页、相邻页与正文引用段落；返回 summary、observation、supports、limitation、evidence、readable、selected、section、reason；字段不全即失败 | `visuals/NNNN.json`（逐图缓存）→ `visual_analysis.json`（含正文提及但未提取到的图表） | `visuals.analyze_visuals` |
| `visual_plan` | 一次调用形成全局选图计划；`plan_problems` 不通过时带问题列表修正一次，仍不通过则失败 | `visual_plan.json` | `visual_plan.build_visual_plan`、`visual_contract.plan_problems` |
| `what` … `question` | 阶段提示词追加图表清单、预读结论与计划；要求按计划在指定章节插入 `![Figure N](figures/xxx.png)` 并讲解 | `stages/*.md` | `prompts.py` / `sectioned.py` 的图表段落 |

- `skill.md` 恢复参考项目的插图条款（`figure_analysis_protocol.md` 原文移植）；删除 V1「报告不得含图片」的提示与校验。
- `validate_report` 增加：插图路径必须出自 manifest；计划中 `include=true` 的图必须出现在指定章节；未入计划的插图报错（移植 `coverage_problems`）。
- 无图论文（manifest 为空）跳过 `visuals` / `visual_plan` 调用，写入空分析与空计划后继续。
- 成本：每张图/表一次调用（常见论文 10–20 张），上下文上限 24000 字符，与参考项目相同。

## 4. 前端

### 4.1 插图渲染

- `DeepReadMarkdown` 的 `img` 渲染器：`figures/…` 拼成 `deepread/<id>/figures/…`，经现有 `read_managed_file`（限定在资料库目录内）读取字节，生成 blob URL 显示。`deepread_get` 返回 `figures`（manifest）供前端定位图表区域。
- 阶段进度条增加「图表提取 / 看图预读 n/N / 选图计划」。

### 4.2 段落坐标

- `pdfParagraphs.ts` 切段时为每段记录逐行矩形：用 pdf.js 页面 viewport 把文本项坐标换算成 0–1 归一化矩形，与阅读台批注的 `Rect` 同一坐标系。
- `sections.json` 段落新增 `rects`；V1 已创建的任务没有该字段，按空数组读取：可跳页，不高亮。

### 4.3 对照阅读视图

```text
┌ [任务切换 ▾]  [退出对照] ───────────────────────────────────────────────┐
│ 精读报告（左 50%）                    │ 阅读台 PdfReader（右 50%）        │
│ … 现有方法依赖全量检索 [p.3 · P0042]  │   第 3 页                         │
│ ![Figure 2]  ← 点击跳到图表区域       │   ███ 证据段落高亮（数秒后淡出）███ │
└──────────────────────────────────────┴───────────────────────────────────┘
```

- 入口：报告页按钮「对照阅读」，任务未关联论文库论文时禁用并提示先「加入论文库」。
- 证据锚点：解析 `(Evidence: …)` 中的页码与段落 ID（含 `P0017–P0019` 区间），渲染为可点击标签；点击 → 跳到首段所在页 → 高亮这些段落的矩形。
- 插图点击：用 manifest 的 `regionBoundary`（72 DPI 坐标）换算归一化矩形，跳页并高亮图表区域。
- `PdfReader` 新增 `pane` 布局（嵌入右半屏，侧栏默认收起）与 handle 方法 `reveal(page, rects)`；`ContinuousAnnotatablePdf` 新增临时高亮层，不写入批注。
- 任务切换：只列已关联论文的任务；切换或退出前沿用 `PdfReaderHandle.isDirty()` 的未保存批注确认。

## 5. 分步与验收

| 步骤 | 内容 | 验收 |
|------|------|------|
| 1 | 构建脚本、jar、精简运行时、`bundle.resources` | 用 9 页样例论文直接运行 jar，得到图表 PNG 与 JSON |
| 2 | 后端 `figures` / `visuals` / `visual_plan` 阶段、提示词、校验 | `cargo test deepread` 覆盖 manifest 解析、上下文选段、预读字段、`plan_problems`、`coverage_problems`、插图来源 |
| 3 | 插图渲染、阶段进度 | vitest 覆盖图片渲染器；样例论文报告内插图可见 |
| 4 | 段落坐标、对照阅读视图、证据锚点解析、`reveal` 高亮 | vitest 覆盖锚点解析与矩形换算；桌面端点击锚点跳页高亮正确 |
| 5 | 文档同步、版本 0.2.51、桌面实测、打包 | 安装包与便携版均能提取图表 |
