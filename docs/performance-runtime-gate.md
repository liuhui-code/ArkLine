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

The scripts print JSON with p50, p95, max, and pass/fail status. Use the same
machine, Node version, fixture size, and command flags when comparing runs.

## Release Policy

- A release candidate must include fresh performance output in `docs/performance-baseline.md`.
- A failing `--strict` run blocks release unless the regression is explicitly accepted.
- If a real workspace behaves worse than the synthetic fixture, prioritize the real
  workspace result.
- Diagnostics must show IPC commands over 100 ms and UI long tasks over 100 ms.

## Current Gate Status

Phase 8 starts with headless model-level smoke scripts. Browser-level and packaged
app checks should be added after the runtime scripts are stable in CI.
