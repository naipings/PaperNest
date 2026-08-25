# 文件夹系统复测与修正

**Date**: 2026-08-25 14:56  
**Type**: Bug Fix  
**Project**: paperReader_codex / PaperNest 0.1.87  

## Problem

对文件夹功能做全量复测（预览 UI + 真实 PDF 后端测试 + 原生 exe），查找隐藏问题。

## Root Cause

1. `Ctrl+X` 只读 `App` 的 `selectedId`，多选勾选无法剪切。  
2. 切换文件夹后 `checkedIds` 残留不可见 id，批量栏状态易错乱。  
3. 文件夹操作按钮仅 hover 显示，选中态不便发现；树节点无障碍标签不足。

## Changes

- `PaperTable`：捕获阶段 `Ctrl+X` 优先剪切勾选；`papers` 变化时修剪勾选。  
- `styles.css`：`.folder-row.active` 也显示操作按钮。  
- `FolderTree`：`role="treeitem"` + `aria-label`。  
- `LibraryView`：剪切提示文案与「取消剪切」按钮分隔。  

## Verification

- 浏览器预览：建 CS/NCS/AAAI 子树、移动、剪切粘贴、粘贴到「全部」拒绝、非空删拒绝、软删后删空父+空子、知识树定位到 NCS。  
- `vitest` 142 passed；`folder_smoke` / `folder_pdf_import` / `schema_smoke` passed（含 `release/windows/CS`、`NCS` PDF）。  
- `PaperNest.exe` 启动成功；已打包 `0.1.87`。

## Outcome

隐藏交互问题已修并发布 `release/windows/PaperNest.exe`（0.1.87）。  
