# Phase 152: Reference Refresh Content Budget

## Goal

Add a bounded source-content loading budget to reference refresh.

## Why

Reference refresh is part of the deep index path that runs after large-project
open. It must not let one unusually large source file, or one large refresh
batch, monopolize background indexing. Mature IDE indexers treat heavyweight
files as degraded inputs: declaration-level indexing can continue, while deeper
identifier/member reference scans are skipped until a future targeted strategy
can handle them.

## Changes

- Added `ReferenceRefreshContentBudget` with per-file and per-refresh total byte
  caps.
- Kept `plan_reference_refresh_content` compatible by using a default budget.
- Added `plan_reference_refresh_content_with_budget` for tests and future
  profile-driven tuning.
- Recorded skipped oversized source paths in `ReferenceRefreshContentPlan`.
- Exposed skipped content count in the test-only reference refresh profile.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_refresh_plan_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests`
- `pnpm check:line-count`
- `pnpm check:fast`
