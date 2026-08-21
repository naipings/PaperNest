# 编辑论文点空白不弹窗

**Date**: 2026-08-21 17:12  
**Type**: Bug Fix  
**Project**: paperReader_codex / PaperNest  
**Status**: Fixed

## Problem Description

编辑论文有未保存修改时，点弹窗外空白区域不出现「编辑信息未保存，是否保存？」提示；「取消」直接关闭已正常。

## Root Cause

1. 遮罩关闭绑在 `mousedown` 上，WebView 在鼠标按下阶段同步调 `window.confirm` 常被吞掉或立刻返回，界面上看不到对话框。
2. 桌面端应走 Tauri `@tauri-apps/plugin-dialog` 的 `ask`，与导入重复文献确认一致。

## Changes Made

- `Modal.tsx`：改用 `click`，且仅 `event.target === event.currentTarget` 时关闭；面板内 `stopPropagation`。
- `PaperEditor.tsx`：桌面端 `ask`，浏览器仍 `confirm`；`paperRef` + 微任务确保 dirty 读取最新；「取消」仍直接 `onCancel`。
- 测试与文档更新；版本 `0.1.79`；产物复制到 `release/windows/`。

## Verification

- Vitest：`PaperEditor.save.test.tsx`、`Modal.test.ts` 通过。
- 浏览器：编辑标题后点遮罩，确认文案被调用。
- 请用户用 `release/windows/PaperNest.exe`（0.1.79）验证系统 ask 对话框。

## Outcome

点空白/关闭/Esc 在有修改时应弹出保存确认；取消按钮仍不弹窗。
