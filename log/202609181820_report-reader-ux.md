# 调研报告阅读 UX 改造

**Date**: 2026-09-18 19:18  
**Type**: Plan / Solution Analysis + Verification  
**Project**: paperReader_codex  
**Status**: Shipped 0.2.37

## Background

深度调研长报告原先整篇嵌在「对话」Tab，受 `max-height: 48vh` 限制，与聊天流混在一起，阅读需频繁滚动，主体也不易与问题区分。

## Proposed Solution

对齐常见开源/产品做法（ChatGPT Artifact、Manus/Gemini 侧栏文档、GPT Researcher 独立报告页）：长文档从聊天流拆出。

1. 新增「报告」Tab：全高文档框阅读 Markdown，多轮可切换，支持复制全文。
2. 对话 Tab：问题气泡 + 带框报告卡片入口，点击跳转对应轮次报告。
3. 调研/追问成功完成后自动打开「报告」页。

## Key Decisions

- 采用独立 Tab 而非侧栏分栏：现有 ResearchView 已是 Tab 体系，改动最小且可读面积最大。
- 报告区复用轨迹页的 `research-main--expanded` 视口高度逻辑，避免再嵌套 48vh。
- 对话区保留追问与过程/来源，职责仍是「会话操作」，不是「长文阅读」。

## Verification

- `npm run test`：161 passed
- 生产包内含 `research-report-card` / `research-report-document` / `research-report-shell` / 「复制全文」等字符串
- GUI：`log/verify-report-reader/91_报告_960_490.png` 可见「报告 2」激活、轮次切换、复制全文、Markdown 正文阅读区

## Packaging

- `release/windows/PaperNest.exe`
- `release/windows/PaperNest_0.2.37.exe`
- `release/windows/PaperNest_0.2.37_x64-setup.exe`
