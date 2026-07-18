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

Run the strict 20k-file interaction gate:

```bash
ARKLINE_LARGE_FIXTURE_FILES=20000 ARKLINE_STRICT_PERF=1 \
  cargo test --manifest-path src-tauri/Cargo.toml \
  verifies_generated_large_workspace_open_pipeline -- --ignored --nocapture
```

Strict mode requires lightweight workspace opening to finish within 1,500 ms and
an exact Quick Open query to finish within 100 ms. Normal test runs remain
report-only because local debug-build timings vary by machine.

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

## 2026-07-17 Diagnostic Baseline

Debug-profile measurements:

```text
20k lightweight open before Hot FileSearchIndex: 0.98-2.96 s
20k exact Quick Open before Hot FileSearchIndex: 0.57-1.78 s
5k full background refresh: 31.4 s
5k slowest worker ticks: 2.18 s, 2.14 s, 2.09 s
```

The baseline failed both strict interaction gates because ranking scanned,
allocated, and sorted the complete file catalog for every query.

## 2026-07-17 Hot FileSearchIndex Result

After replacing the full catalog scan with immutable precomputed entries and
bounded postings-based candidate generation:

```text
20k workspace state construction: 41.63 ms
20k hot file search index construction: 239.21 ms
20k lightweight open total: 284.17 ms
20k exact Quick Open: 1.13 ms
100k in-memory hot index construction: 1.70 s
100k mixed Quick Open: p50 1.11 ms, p95 1.99 ms, p99 2.02 ms
```

The strict 1,500 ms open and 100 ms Quick Open gates now pass. Run the report-only
100k in-memory file search profile with:

```bash
cargo test --manifest-path src-tauri/Cargo.toml \
  reports_100k_file_search_index_performance -- --ignored --nocapture
```

This result covers the L0/L1 file catalog and Quick Open path. It does not claim
that symbol, content, semantic, or background refresh workloads meet their later
phase targets.

## 2026-07-17 Durable Index Result

After adding the common WAL connection layer, stable `FileId`, symbol postings,
and token-prefix plus trigram FTS:

```text
20k lightweight open: 467.52 ms
20k exact Quick Open: 1.74 ms
100k FileSearchIndex build: 2.38 s
100k FileSearchIndex query p95: 2.64 ms
100k persisted content warm first-page p95: 26.96 ms
```

Run the strict persisted-content gate with:

```bash
ARKLINE_STRICT_PERF=1 cargo test --manifest-path src-tauri/Cargo.toml --lib \
  reports_100k_persisted_content_first_page_performance -- --ignored --nocapture
```

The content fixture stores 100k distinct paths and content rows in the product
SQLite schema, closes the writer transaction, then measures the normal warm
query path. It isolates storage/query latency from source generation and parsing.
