# Language Query Budget Classification Phase 20

## Goal

Add a stable request-size classification to the shared language-query snapshot boundary without changing request payload semantics.

## Current State

- Language query snapshots expose content length and large-document metadata.
- Controllers still have no common vocabulary for deciding when to prefer indexed, worker-backed, or degraded language operations.
- Existing language APIs still receive full content.

## Plan

1. Add `normal`, `large`, and `oversized` content classes.
2. Keep the existing editor large-document threshold as the large boundary.
3. Add an explicit oversized threshold for future language-query policy.
4. Preserve current request payloads exactly.
5. Add focused tests, then run build/perf/line-count verification.

## Acceptance

- Existing request callers stay source-compatible.
- Metadata exposes content length, large flag, and content class.
- Touched code files remain below 500 lines.
