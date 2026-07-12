# Index Diagnostics Section Navigation Phase 126

## Goal

Make Index Diagnostics Center faster to use during indexing stalls by turning the left section list into real in-panel navigation.

## Changes

- Converted static Diagnostics Center section labels into anchor links.
- Added stable section ids for Processes, Current File, Layers, Query Explain, Language Queries, Health, Parser Errors, Unresolved Imports, and Timeline.
- Added focused component coverage without growing the existing near-limit diagnostics test file.
- Kept link styling in the focused diagnostics CSS file instead of adding more rules to the large app stylesheet.

## Verification

- `pnpm exec vitest run tests/frontend/index-diagnostics-navigation.test.tsx tests/frontend/index-diagnostics-center.test.tsx`

## Next Slice

- Add section-target routing so status bar SDK clicks can open Diagnostics Center and focus Processes or Health directly.
