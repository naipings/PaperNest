# 论文库文件夹实现

- 时间：2026-08-25
- 类型：plan-implementation
- 版本：0.1.86

## 目标

按 `docs/research/folder-system-assessment.md` 实现单归属逻辑文件夹：树 CRUD、导入归属、剪切移动、知识树定位。

## 实现要点

- DB：`folders` + `papers.folder_id`；schema_version=5
- 命令：`save_folder` / `delete_folder` / `move_papers_to_folder`；`import_pdfs` 可选 `folderId`
- UI：`FolderTree` + LibraryView 分栏；Ctrl+X/V；拖拽；详情「所在位置」
- 迁移修复：旧库先 `ALTER` 加列再建 `idx_papers_folder`，避免启动 panic

## 验证

- vitest 142 passed
- cargo test folder_smoke / schema_smoke passed
- `release/windows/PaperNest.exe` 启动成功（修复迁移后）
- 测试 PDF：`release/windows/CS`、`release/windows/NCS`（供本地导入验证）

## 交付

- `release/windows/PaperNest.exe`
- `release/windows/PaperNest_0.1.86.exe`
- `release/windows/PaperNest_0.1.86_x64-setup.exe`
