# Content Match Service Phase 104

## Goal

Move pure content-search matching helpers out of `workspace_content_index_service.rs`.

## Why

Global content search is one of the most latency-sensitive IDE paths. The content index service mixed SQLite indexing/query orchestration with pure match logic for case sensitivity, whole-word filtering, summaries, and context slicing. Separating this makes future search responsiveness work safer.

## Scope

- Add `workspace_content_match_service.rs`.
- Move line matching, whole-word boundary checks, UTF-8-safe summary building, and context slicing into the helper.
- Preserve existing indexed content search behavior.
- Add focused tests for case sensitivity, whole-word matching, UTF-8-safe summaries, and 1-based context lines.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_content_match_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_content_index_service_tests`
- `pnpm check:fast`
