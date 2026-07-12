# Phase 164: Query Explain Live Event Emit

## Goal

Make query explain results visible through the same live workspace index event stream used by task and scheduler events.

## Why

Query Explain already persisted diagnostic events, but the command returned only the explain result. The UI could show the immediate modal result while the index event projection stayed stale until another refresh path ran. For large-project diagnosis, query misses must appear in the live event stream immediately.

## Changes

- Added `explain_and_record_workspace_index_query_with_event` in the explain service.
- Kept the previous result-only service API as a compatibility wrapper.
- Updated the Tauri `explain_workspace_index_query` command to emit `workspace-index-event` after persistence.
- Added a focused service test that verifies the returned event matches the persisted query event.

## Design Notes

- Persistence remains in the service layer.
- Live emit remains in the command layer because it owns `AppHandle`.
- The returned event is the same event stored in SQLite, so the diagnosis history and live projection share one event identity.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml records_and_returns_query_event_for_live_emit`
- `pnpm check:line-count`
- `pnpm check:fast`

## Next

- Surface query events more prominently in the Index Diagnostics timeline.
- Add command-level integration coverage when the Tauri test harness can capture emitted events cheaply.
