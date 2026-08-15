# 导入有双语摘要无总结术语

**Date**: 2026-08-15 15:41  
**Type**: Bug Fix  
**Project**: paperReader / PaperNest  
**Status**: Fixed

## Problem Description

部分新导入论文有中英文双语摘要，但一句话总结为「待补充」、术语为 0。同批其他论文可正常生成总结与术语。

## Root Cause

1. `fillFromPdf` 会先用封面启发式 + 翻译写出 `abstractEn`/`abstractZh`。
2. 随后整篇 `analyze_paper_with_llm` 若失败（带图请求超时、JSON 中 vocabulary 单项缺字段/`page` 为字符串导致整次 `serde` 失败），catch 后保留封面结果 → 看起来像「只有双语摘要」。
3. 库内 IRP 篇：摘要有、`summary` 空、vocabulary 0；同批另两篇 LLM 字段齐全。

## Changes Made

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | `parse_llm_analysis` 软解析；强化 summary/vocabulary 必填提示 |
| `src/lib/importLlmFill.ts` | 缺字段检测、摘要轻量 seed、合并 |
| `src/components/LlmTopbar.tsx` | 纯文本优先分析；仍缺则标题+摘要补全 |
| docs | 0.1.40 |

## Outcome

前端相关单测通过；需 `tauri build` 后用新 exe 验证再导入。
