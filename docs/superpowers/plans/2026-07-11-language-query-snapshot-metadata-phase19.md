# Language Query Snapshot Metadata Phase 19

## Goal

Add lightweight observability metadata to the shared language-query snapshot boundary without changing the language service request protocol.

## Current State

- Completion, Definition, Find Usages, and Code Actions now share request construction.
- The shared builder still returns only the protocol request.
- Future content budget and diagnostics need content size and large-document classification in one place.

## Plan

1. Add `buildLanguageQuerySnapshot`.
2. Include `contentLength` and `largeDocument` metadata.
3. Keep `buildLanguageQueryRequest` returning the current request shape.
4. Reuse the existing large-editor-document threshold.
5. Add focused tests and run build/perf/line-count verification.

## Acceptance

- Existing callers remain source-compatible.
- Metadata is available for future diagnostics and budget policy.
- Touched code files remain below 500 lines.
