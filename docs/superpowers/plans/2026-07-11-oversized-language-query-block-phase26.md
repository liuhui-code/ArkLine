# Oversized Language Query Block Phase 26

## Goal

Stop oversized LanguageQuery snapshots from continuing into legacy synchronous language-service and fallback paths after the snapshot is recorded.

## Scope

- Completion skips provider calls when the guard says synchronous requests should be avoided.
- Definition keeps indexed readiness lookup first, then skips legacy `gotoDefinition` and local full-content fallback for oversized misses.
- Usages keeps indexed readiness lookup first, then skips legacy `findUsages` when no indexed query support is available.
- Tests prove the legacy APIs are not called for oversized inputs.

## Non-goals

- Do not avoid the first `getActiveContent()` snapshot yet.
- Do not add indexed-only completion provider behavior in this phase.
- Do not change normal or large request behavior.

## Next Phase

Introduce budgeted LanguageQuery snapshots so oversized files can be classified before copying or forwarding full editor content.

## Verification

- Run focused controller tests.
- Run runtime responsiveness guard.
- Run production build.
- Keep touched code files below 500 lines.
