# Local Definition Scan Budget Phase 13

## Goal

Reduce Ctrl+Click and definition fallback latency by removing full-document line array allocation from local definition lookup.

## Current Hot Path

- Local definition fallback converts line/column to an offset with `content.split("\n")`.
- Declaration preview also splits the whole document.
- Declaration scanning builds a full line array before testing declaration matchers.

## Plan

1. Add a small workspace text scanner for line/column offset, line preview, and line iteration.
2. Replace local definition split-based helpers with scanner calls.
3. Keep local definition behavior compatible for same-file, imports, and workspace candidates.
4. Add focused scanner tests for large documents, CRLF, and out-of-range lines.
5. Run focused tests, runtime perf, build, line-count checks, and commit.

## Acceptance

- Definition fallback no longer allocates full line arrays on its hot helpers.
- Local definition tests keep passing.
- All touched code files remain under 500 lines.
