# Import abstract, duplicates, and sticky checkbox column

**Date**: 2026-08-15 00:33  
**Type**: Bug Fix  
**Project**: paperReader / PaperNest  
**Status**: Partially Fixed → Fixed (round 2)

## Round 2 — 2026-08-15 00:47

User rebuilt 0.1.30 and reported: frozen checkbox header/body misaligned; English abstract still empty; duplicate import still silent.

### Root Cause

1. Abstract: space-only PDF.js items were dropped (`item.str.trim()`), so word gaps vanished; `AbstractThe…` failed `\babstract\b`; extract errors were swallowed so hash/DOI never saved.
2. Duplicate: filename titles like `1706.03762` have normalized length 9, below the old `> 12` cutoff; `pdfSha256` was never written.
3. Table: left-`sticky` on the checkbox column plus different `th`/`td` padding and a header resize handle offset the header checkbox from the body.

### Changes Made

| File | Change |
|------|--------|
| `src/lib/pdfCoverMeta.ts` | Raw-text abstract (`AbstractThe…`), Subject fallback |
| `src/lib/extractPdfCover.ts` | Keep spaces; pass raw dump into inferCoverMeta |
| `src/lib/paperDuplicate.ts` | Hash / filename arXiv / title length >= 8 |
| `src/components/LlmTopbar.tsx` | Always hash the PDF before extract; still save if extract throws |
| `src/styles.css` / `PaperTable.tsx` | Remove left sticky; `col-select` 48px centered, no resize handle |

### Outcome

`npm run check`: 32 tests passed, `tsc` and Vite build passed. No left-sticky rules remain in `styles.css`.


## Problem Description

1. Importing a PDF did not fill the English abstract.
2. Importing the same paper again always succeeded, with no duplicate prompt. Different arXiv versions of the same work should still import, with a cross-reference to earlier versions.
3. The library table no longer misaligned at rest, but scrolling right made other column grid lines show through the checkbox column.

## Root Cause

1. PDF.js often emits one glyph per text run. `clusterLines` always inserted a space between runs, so `Abstract` became `A b s t r a c t` and the heading regex never matched.
2. `import_pdfs` always created a new row. Duplicate checks only ran after optional LLM analysis and never blocked the import. There was no place to store version links.
3. Left-frozen columns used `position: sticky` without an opaque stacking context. Horizontally scrolling cells painted their `border-right` on top of the checkbox column. Container padding plus `left: 0/40/78` also fought each other.

## Changes Made

| File | Change |
|------|--------|
| `src/lib/pdfCoverMeta.ts` | Join glyphs by gap, keep space runs, tighten `A b s t r a c t`, looser Abstract/摘要 match |
| `src/lib/extractPdfCover.ts` | Pass `hasEOL` from PDF.js |
| `src/lib/paperDuplicate.ts` | Classify same vs arXiv version; merge version clusters |
| `src/components/LlmTopbar.tsx` | Confirm duplicates after cover extract; purge if declined; link versions |
| `src-tauri/src/schema.sql` / `lib.rs` | `related_paper_ids_json` column, ALTER for existing libraries |
| `src/components/DetailPanel.tsx` | Overview shows historical versions |
| `src/styles.css` | Freeze only the checkbox column with opaque background and edge shadow |

## Outcome

- Vitest: 27 passed. `cargo test` schema smoke passed. `npm run check` passed.
- Same DOI / same arXiv version / same normalized title prompts before keeping the new file.
- Different arXiv versions import and appear under 历史版本 on the detail overview.
- Checkbox column stays put while scrolling and should no longer show foreign grid lines.

## Notes

Desktop verification still needs `npm run tauri build` (or `tauri dev`) against a real PDF whose Abstract is glyph-split, a second import of the same file, and an arXiv v1/v7 pair.
