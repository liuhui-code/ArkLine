# Line Count Guard Phase 76

## Goal

Add an executable guard for the 500-line code-file rule so AppShell and frontend runtime cleanup does not regress.

## Scope

- Add `scripts/check-line-count.mjs`.
- Add `pnpm check:line-count`.
- Scan current frontend/runtime production roots:
  - `src`
  - `semantic-worker/src`
  - `scripts`
- Ignore generated/dependency/build directories and test fixtures.
- Keep the guard importable so its path filtering can be unit tested.

## Current Boundary

The guard intentionally does not scan `src-tauri/src` yet because the Rust backend already has legacy files above 500 lines:

- `src-tauri/src/services/language_service.rs`
- `src-tauri/src/services/workspace_edit_service.rs`
- `src-tauri/src/services/workspace_index_scheduler_service.rs`

Those need a separate backend split phase before the same gate can be expanded to Rust.

## Verification

- Unit test covers target filtering and limit reporting.
- `pnpm check:line-count` must pass.
- Build, runtime perf, diff whitespace, and git status gates before commit.
