# 批量栏与文件夹栏宽度

**Date**: 2026-08-25 16:25  
**Type**: Bug Fix  
**Project**: paperReader_codex / PaperNest 0.1.88  

## Problem

1. 单击论文行即出现「已选中 / 剪切 / 移动到…」批量栏，干扰普通浏览。  
2. 文件夹栏宽度固定，无法像资源管理器那样拖拽调整。

## Changes

- `PaperTable`：批量栏仅在勾选复选框时显示。  
- `FolderTree`：右侧拖拽条调整宽度，写入 `localStorage`。  

## Outcome

已打包 `release/windows/PaperNest.exe`（0.1.88）。
