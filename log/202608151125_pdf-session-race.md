# Same PDF: first import bad, second good

**Date**: 2026-08-15 11:25  
**Type**: Bug Fix (root cause)  
**Project**: paperReader / PaperNest  
**Status**: Fixed (0.1.35)

## Problem

Same PDF imported twice: first fill had authors/abstract polluted (Introduction bled into English abstract; no 中文摘要 / 一句话总结 / 术语); second import looked correct.

## Root Cause

1. Import opened PDF.js twice in a row: cover extract → `destroy` → LLM `preparePaperAnalysis` → `getDocument`. Shared-worker race (mozilla/pdf.js#16777) often broke the first LLM path; dirty cover heuristics stayed in the DB.
2. Second import: worker already warm, LLM succeeded and overwrote fields — looked like flaky parsing.
3. Secondary: `cleanAbstractText` stop regex ran on flat text without `unsplitSmallCaps`, so `1 I NTRODUCTION` did not cut the abstract.

## Fix

| File | Change |
|------|--------|
| `src/lib/pdfSession.ts` | Serialize opens; `await loadingTask.destroy()` |
| `src/lib/extractPdfCover.ts` | `extractForImport`: one session for cover + analysis text |
| `src/components/LlmTopbar.tsx` | Use precomputed text; vision fail → text-only retry; LLM wins writeback |
| `src/lib/pdfCoverMeta.ts` | unsplit before Introduction stop on flat/raw paths |

## Verify

- `npm run check`: 46 tests, frontend build OK
- `release/windows/PaperNest.exe` rebuilt from this change
