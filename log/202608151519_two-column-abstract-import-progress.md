# 双栏摘要污染与导入进度消失

**Date**: 2026-08-15 15:19  
**Type**: Bug Fix  
**Project**: paperReader / PaperNest  
**Status**: Fixed

## Problem Description

1. 新导入 3 篇论文中有 2 篇英文摘要异常（以 `(ii)…` 开头，或夹杂图坐标轴数字如 `350` / `User number`）。
2. 导入未完成时切到其他界面再回论文库，顶栏导入进度消失。

## Root Cause

1. **不是 Abstract 标题没找到**。双栏（及 Abstract 旁附图）首页按 `y` 再 `x` 拼行时，左栏 Abstract 与右栏同基线文本被拼进同一行；行级摘要优先于干净的 raw，脏结果写入库。两篇无 `titleZh`/`summary` 说明 LLM 未覆盖成功，脏封面摘要留存。
2. 导入 `busy`/`notice` 是 `Topbar` 本地 `useState`；`App` 仅在 `screen === "library"` 挂载 Topbar，切换即卸载，状态清空（异步导入仍在跑）。

## Changes Made

| File | Change |
|------|--------|
| `src/lib/pdfCoverMeta.ts` | 按最大水平空隙分栏只读 Abstract 列；污染检测；`KoreaABSTRACTIn` raw 匹配 |
| `src/lib/pdfCoverMeta.test.ts` | 双栏引言串扰、图轴数字、粘连 Abstract 用例 |
| `src/state/LibraryContext.tsx` | `importBusy` / `importNotice` |
| `src/components/LlmTopbar.tsx` | 读写 Context 进度 |
| `src/App.tsx` / `src/llm.css` | 非论文库界面显示导入横幅 |
| `docs/CHANGELOG.md` / `docs/DEVELOPMENT.md` | 0.1.39 |

用 `log/abs-debug/*-items.json` 复验：IRP 与 HeteFedRec 摘要均从正确句首开始且无污染。

## Outcome

`pdfCoverMeta` 相关测试通过；打包见本次会话后续 `npm run check` / `tauri build` 结果。
