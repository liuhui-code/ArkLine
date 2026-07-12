# Index Diagnostics Query Explain Section Extraction Phase 134

## Goal

Keep query-miss diagnostics maintainable while preserving the user-readable explain chain for search, definition, usages, and completion misses.

## Changes

- Extracted Query Explain into `IndexDiagnosticsQueryExplainSection`.
- Preserved the existing section id, accessible region name, recent count, newest-first timeline rendering, summary fields, raw explain text, and empty state.
- Kept timeline construction in the existing query explain model and passed the rendered view data into the section.
- Reduced `IndexDiagnosticsCenter.tsx` to about 300 lines.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-center.test.tsx tests/frontend/workspace-query-explain-model.test.ts`
- `pnpm check:line-count`

## Next Slice

- Extract Performance Timeline or parser/unresolved evidence sections if diagnostics UI continues to grow.
