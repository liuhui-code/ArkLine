# Regex Search Prefilter Phase 89

## Problem

Global text search still uses filesystem fallback for regex queries. When a
regex contains an obvious literal token, ArkLine was still running the regex
against every indexed file in that fallback path.

That is unnecessarily expensive on medium and large workspaces.

## Goal

Add a conservative literal prefilter for regex fallback search without changing
regex result semantics.

## Implementation

- Extract the longest deterministic literal hint from regex sources.
- Ignore hints shorter than three characters to avoid noisy filters.
- Skip regex scanning for files whose content cannot contain the literal hint.
- Preserve the existing fallback path when no reliable literal hint exists.
- Keep pagination, cancellation, UTF-8 summaries, and normal text search
  behavior unchanged.

This is a small fallback-layer optimization. It does not replace the longer-term
roadmap item for FTS/trigram-like regex candidate selection.

## Verification

```sh
cargo test --manifest-path src-tauri/Cargo.toml workspace_text_search_service_tests
pnpm check:fast
```
