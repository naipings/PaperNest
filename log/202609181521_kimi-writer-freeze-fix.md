# 文献调研 Kimi 适配与 Writer 卡死

**Date**: 2026-09-18 15:21  
**Type**: Bug Fix  
**Project**: paperReader_codex  
**Status**: Fixed

## Problem Description

1. Kimi 系列（阿里云 MaaS compatible-mode）测试连接报不支持参数 `temperature=0.2`。
2. deep 文献调研跑到末尾卡死，报错：`error sending request for url (...maas.aliyuncs.com/.../chat/completions)`。失败会话 `df31465b-...`，DSH 停在 270/271（Writer `step/start` 之后无 assistant）。

## Root Cause

1. `research_llm` / `research_llm_web` / 通用整理 LLM 硬编码 temperature；Kimi/Moonshot 在 MaaS 上只允许服务端固定 sampling 参数。
2. 现场证据：Reviewer（seq 264）成功；Writer（seq 267–270）失败。Writer 用户提示约 **147KB**（275 来源 × 800 字摘录），`reportMaxTokens=30000`，超时 300s。HTTP 客户端无 TCP keepalive，长生成等待期间连接被中间网络/网关掐断；重试仅 3 次且退避过短。

## Changes Made

| File | Change |
|------|--------|
| `src-tauri/src/research_llm.rs` | Kimi/Moonshot 省略 temperature；TCP keepalive；最多 5 次传输重试；错误链透出 |
| `src-tauri/src/research_llm_web.rs` | 同步 temperature 省略与 keepalive |
| `src-tauri/src/lib.rs` | 通用整理 LLM 同步上述两点 |
| `src-tauri/src/research.rs` | Writer 来源摘录按约 60KB 总量预算动态收缩 |
| `docs/CHANGELOG.md` / `docs/DEVELOPMENT.md` | 记为 0.2.34 |

## Outcome

- 单测：`kimi_omits_temperature`、`qwen_keeps_temperature`、`writer_excerpt_shrinks_for_large_source_sets`、`writer_sources_block_stays_bounded` 通过。
- 实请求验证（失败会话 275 来源 + 同 MaaS 端点 `qwen3.8-flash`）：
  - 载荷：旧 151KB → 新 94KB（摘录 800→218）
  - 短写：`max_tokens=1200`，15.8s，HTTP 200
  - 长写：`max_tokens=4000`，69.3s，HTTP 200，产出 2133 字
- 打包：`release/windows/PaperNest.exe`、`PaperNest_0.2.34.exe`、`PaperNest_0.2.34_x64-setup.exe`

## Notes

- 当时设置模型为 `qwen3.8-flash`（非 Kimi）；Kimi 问题由连接测试路径独立确认。
- 未在 GUI 内对失败任务做完整「从此处恢复」端到端（会再烧一轮 30k Writer）；HTTP/载荷路径已用同会话数据验证。
- Kimi 思考模式下工具调用还需保留 `reasoning_content`；本次未改消息组装，若后续 tool calling 报错再单独立项。
