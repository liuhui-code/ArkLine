# Completion Prefix Budget Phase 12

## Goal

Reduce foreground completion cost for medium and large files by removing full-document line splitting from prefix and presentation-context calculation.

## Current Hot Path

- Typing completion calls `requestCompletion`.
- `requestCompletion` gets the active document content and calculates `replacePrefix`.
- Completion presentation also calculates `lineTextBeforeCursor`.
- Both paths currently split the whole document into lines.

## Plan

1. Add a shared local-line helper in `app-shell-helpers`.
2. Rewrite `extractCompletionPrefix` to scan only until the requested line.
3. Reuse the same helper in `useCompletionController`.
4. Add focused tests for CRLF, out-of-range lines, and large-line positioning.
5. Run focused tests, runtime perf, build, line-count checks, and commit.

## Acceptance

- Completion prefix behavior stays compatible with existing usage.
- No completion-controller file exceeds 500 lines.
- `pnpm build` and focused tests pass.
