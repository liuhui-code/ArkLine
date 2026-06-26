# Large Workspace Fixture Verification

ArkLine keeps the default test suite fast and runs large workspace checks explicitly.

## Commands

Run the default 10k-file fixture:

```bash
cd src-tauri
cargo test verifies_generated_large_workspace_fixture_pipeline -- --ignored --nocapture
```

Run larger fixtures:

```bash
cd src-tauri
ARKLINE_LARGE_FIXTURE_FILES=50000 cargo test verifies_generated_large_workspace_fixture_pipeline -- --ignored --nocapture
ARKLINE_LARGE_FIXTURE_FILES=200000 cargo test verifies_generated_large_workspace_fixture_pipeline -- --ignored --nocapture
```

The fixture generator creates ArkTS-like files under `entry/src/main/ets/pages/bucket-*`, adds excluded dependency output under `oh_modules`, scans the workspace, indexes it, persists the catalog to SQLite, and verifies Quick Open returns indexed results.

## Current 10k Baseline

Measured locally on 2026-06-26:

```text
requested_files: 10000
scanned_files: 10000
indexed_files: 10000
truncated: false
quick_open_hits: 20
generate_duration: 3.23978327s
scan_duration: 159.861429ms
index_duration: 434.761687ms
query_duration: 132.162635ms
```

The 50k and 200k runs are explicit because normal workspace scanning currently caps at 20,000 files and marks larger projects partial. Those runs should confirm truncation behavior stays predictable while the UI remains usable.
