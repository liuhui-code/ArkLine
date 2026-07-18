# ArkLine Runtime Performance Gate

## Purpose

Every release must prove that core IDE interactions stay responsive while indexing,
search, language requests, file switching, and logs are active. The gate is designed
to catch regressions that make medium or large projects feel frozen.

## Required Scenarios

Run the gate against synthetic fixtures and at least one real ArkTS workspace:

| Scenario | Target |
|---|---:|
| Search Everywhere type/delete 100 characters | p95 <= 50 ms |
| Ctrl+Shift+F type/delete 100 characters | p95 <= 50 ms |
| Switch 50 files | first paint p95 <= 300 ms |
| Open 5k, 20k, 100k file projects | editor usable before full index |
| Scroll one large source file | no visible blanking |
| Index while editing | editor input remains responsive |
| Stream logs while searching | search input remains responsive |

## Local Smoke Commands

```bash
pnpm perf:runtime
node scripts/perf-search-input.mjs --files=5000 --strict
node scripts/perf-file-switch.mjs --files=5000 --switches=50 --strict
```

The scripts execute `tests/frontend/runtime-interaction-soak.test.tsx` through
Vitest and print `ARKLINE_PERF` JSON records. They import ArkLine's production
search input, search generation runtime, search session store, document load
coordinator, persistent document store, chunked text builder, and navigation
transaction runtime. They do not use a second benchmark-only search or file
switch implementation.

Reported evidence includes p50/p95/p99, React render commits, bounded candidate
count, cancellation and stale-result counts, document cache and pending-load
counts, notifications, and heap delta. Use the same machine, Node version,
fixture size, and command flags when comparing runs.

## Release Policy

- A release candidate must include fresh performance output in `docs/performance-baseline.md`.
- A failing `--strict` run blocks release unless the regression is explicitly accepted.
- If a real workspace behaves worse than the synthetic fixture, prioritize the real
  workspace result.
- Diagnostics must show IPC commands over 100 ms and UI long tasks over 100 ms.

## Current Gate Status

The current command is a deterministic headless product-runtime gate. It proves
local input, cancellation, stale-result rejection, document preparation, and
latest-navigation behavior, but it does not measure Tauri IPC, native WebView
painting, SQLite lock wait, or packaged process memory. Browser-level and
packaged Windows soak gates remain required.
