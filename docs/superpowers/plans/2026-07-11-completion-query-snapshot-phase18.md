# Completion Query Snapshot Phase 18

## Goal

Move Completion request construction onto the shared language-query snapshot boundary.

## Current State

- Definition, Find Usages, and Code Actions use `buildLanguageQueryRequest`.
- Completion still constructs path, line, column, and content locally.
- Completion is the highest-frequency language-query path, so it should share the same future policy entry point.

## Plan

1. Use `buildLanguageQueryRequest` in the completion controller.
2. Compute replacement prefix from `request.content`.
3. Pass the shared request fields to the completion candidate provider.
4. Add a focused test for stable request fields.
5. Run focused tests, build, perf, line-count checks, and commit.

## Acceptance

- Completion behavior stays unchanged.
- Completion language request shape stays stable.
- Touched code files remain below 500 lines.
