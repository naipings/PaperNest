# 轨迹恢复边界与 DSH 视图高度

**Date**: 2026-09-18 17:20  
**Type**: Bug Fix  
**Project**: paperReader_codex  
**Status**: Fixed

## Problem Description

1. 点击「从此处恢复」报错：`恢复点不能落在未闭合的 turn 内`（默认 seq 常为 280）。
2. 点选轨迹事件时 DSH 视图框高度忽大忽小。

## Root Cause

1. Writer 失败留下未闭合 turn 3 后，`default_resume_boundary` 误取全日志最后一个 `step/end`（280，落在 turn 2 的 step/end、turn/end=281 之前），前缀判定未闭合。
2. `useResearchPageLayout` 用 ResizeObserver 观察轨迹 main，高度写入后又触发自身尺寸变化，形成反馈环。

## Changes Made

| File | Change |
|------|--------|
| `research_dsh_store.rs` | 默认取上一 `turn/end`；`resolve_resume_boundary` 向前/向后对齐闭合边界 |
| `useResearchPageLayout.ts` | 高度只随视口/页眉计算，不再观察轨迹 DOM |
| `styles.css` | shell `max-height` 锁定为 fit 高度 |
| `ResearchTrajectoryPanel.tsx` | 恢复边界提示文案 |

## Outcome

- 失败会话实测：旧默认 280（非法）→ 新默认 281；280/285 均可对齐到 281。
- 单测 `failed_writer_turn_defaults_and_snaps_to_last_closed` 通过。
