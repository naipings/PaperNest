# 打开原文无法跳转外部浏览器

**Date**: 2026-08-15 16:03  
**Type**: Bug Fix  
**Project**: paperReader / PaperNest  
**Status**: Fixed

## Problem Description

论文库表格与详情中的「打开原文」按钮点击后无法在系统浏览器中打开链接。

## Root Cause

按钮使用 `window.open(url, "_blank")`。Tauri WebView2 不会把该调用交给系统默认浏览器。

## Changes Made

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | `open_external_url` + `open` crate |
| `src/services/backend.ts` | `openExternalUrl` |
| `src/lib/paperSourceUrl.ts` | sourceUrl / DOI / arXiv 解析 |
| `DetailPanel.tsx` / `PaperTable.tsx` | 改走 backend |
| docs | 0.1.41 |

## Outcome

`npm run check` 通过；`tauri build` 成功。
