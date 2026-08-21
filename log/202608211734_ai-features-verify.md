# 其他 AI 功能回归验证

**Date**: 2026-08-21 17:34  
**Type**: Bug Fix / Verification  
**Project**: paperReader_codex  
**Status**: Fixed（验证通过，边对比度仅代码级确认）

## Problem Description

压缩英文碎提交后，需自行运行软件验证：知识树边对比度、非论文库懒加载、journal/FTS/备份恢复、各类保存与加载错误提示。

## Verification

### 单测（Vitest）— 26/26 通过

LazyScreenBoundary、App.search、WritingLibrary.errors、TaskCalendar.save、PaperEditor.save、StudyClipPanel.save、DetailPanel.figure/upload/term、LlmTopbar.import、LlmSettingsForm、SettingsView.data/profile、App.libraryNotice。

### Rust — 全部通过

- `should_recover_library_*`（3）
- `fts_phrase_escapes_double_quotes`（1）
- `restore_library_files_*`（2）

### 浏览器实机（Vite 预览）

- 论文库首屏未加载 KnowledgeGraph/TaskCalendar/Writing/Settings/Trash 模块；点击后按需出现对应 `.tsx` 资源。
- 任务、写作、设置、回收站、知识树均可打开，无白屏。
- 设置「本地数据」可见备份/恢复按钮；预览态备份提示「不创建 ZIP」（符合 `isTauri` 分支）。
- 知识树当前种子仅 2 篇且相似度为 0，界面显示「0 条可见关联」，无边可肉眼对比；源码确认边透明度由 `0.28+score*0.35` 调整为 `0.42+score*0.42`。

## Outcome

懒加载、错误提示单测与后端恢复/FTS/备份逻辑均通过。边对比度需在有可见关联边的库中再肉眼确认。
