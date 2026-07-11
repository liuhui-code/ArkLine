# Definition Query Snapshot Phase 17

## Goal

Move Go to Definition request construction onto the shared language-query snapshot boundary and avoid rereading active content during same-file fallback.

## Current State

- Find Usages and Code Actions use `buildLanguageQueryRequest`.
- Go to Definition still constructs `{ path, line, column, content }` inline.
- Definition fallback rereads active content through `getActiveContent()` when resolving same-file reads.

## Plan

1. Use `buildLanguageQueryRequest` for definition requests.
2. Support modifier-click selection override through the shared builder input.
3. Reuse `request.content` in same-file fallback reads.
4. Add a focused test proving active content is read once for fallback same-file definition.
5. Run focused tests, build, perf, line-count checks, and commit.

## Acceptance

- Definition request shape stays unchanged.
- Same-file fallback does not reread active content.
- Touched code files remain below 500 lines.
