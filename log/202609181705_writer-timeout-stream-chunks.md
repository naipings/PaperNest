# 深度调研 Writer 超时与大 token 可靠性

**Date**: 2026-09-18 17:05  
**Type**: Bug Fix  
**Project**: paperReader_codex  
**Status**: Fixed

## Problem Description

失败会话 `7af2a20a-...`：跑到约 103 个 step 后报错  
`调研 LLM 请求发送失败（已重试 4 次）：... operation timed out`。  
DSH 停在 Writer `step/start`（seq 285）；`reportMaxTokens=30000`，固定超时 300s。

## Root Cause

单次非流式请求要求生成最多 30k tokens，现场同载荷流式实测：6k tokens 就要约 **178s**。线性外推 30k 需约 **15 分钟**，远超硬编码 300s；超时后再原样连撞 4 次只会重复失败并浪费时间/配额。  
上一版 keepalive + 来源收缩不够：超时是生成时间问题，不是纯连接抖动。

## Changes Made

| File | Change |
|------|--------|
| `research_llm.rs` | 长输出流式 SSE；按 max_tokens 自适应超时（≤20min）；超时最多再试 1 次 |
| `research_writer.rs` | 分段续写（6k×最多 8 段），累计到 reportMaxTokens |
| `research.rs` | Writer 来源预算约 40KB |
| `research_react.rs` | 工具观察截断 3500；ReAct 超时随上下文增大 |
| `research_dsh_compact.rs` | 压缩阈值 0.55 / 多轮 0.45 |
| `tauri.conf.json` / CHANGELOG | 0.2.35 |

## Outcome

- 实请求：失败会话 380 来源、~92KB 提示；流式 chunk1 6k/178s、chunk2 4k/133s，合计写出 16k+ 字 PASS。
- 单测：adaptive_timeout、writer_excerpt、compaction policy、context usage 阈值 通过。

## Notes

- 保证策略：单次请求可控（流式 + 分段），总篇幅用多段累计逼近用户 `reportMaxTokens`，而不是一次堵死。
- 恢复建议：在 Reviewer 结束后边界「从此处恢复」重跑 Writer。
