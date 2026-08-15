# Reader capture: LLM translation fallback + purpose dropdown

**Date**: 2026-08-15 11:45  
**Type**: Feature  
**Project**: paperReader / PaperNest  
**Status**: Done (0.1.36)

## Changes

1. `translateEnglishToChineseWithFallback`: LibreTranslate first; on miss/fail use `translate_with_llm` when API key saved.
2. Writing-purpose dialog with `<select>` of existing labels +「新增类别…」 instead of `window.prompt`.
3. Selection toolbar and QuickCapture both use the new flows.

## Verify

50 tests + frontend build; `release/windows/PaperNest.exe` updated.
