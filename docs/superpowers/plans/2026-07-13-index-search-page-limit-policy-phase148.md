# Phase 148: Search Page Limit Policy

## Goal

Add a backend hard cap for indexed search result pages.

## Why

Search Everywhere and file-symbol queries are latency-sensitive entry points. The UI normally asks for small pages, but the backend should not trust caller-provided limits. Oversized limits can amplify SQLite work, sorting, serialization, and frontend rendering pressure in large projects.

## Changes

- Added `normalize_candidate_page_limit` for indexed candidate and file-symbol pages.
- Normalization maps `0` to `1` and caps oversized requests at `100`.
- Candidate pagination now uses the normalized limit for fetch size, returned item count, and `next_cursor`.
- Added regression coverage for direct limit normalization and oversized Search Everywhere file-scope pages.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_index_candidate_page_service_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
