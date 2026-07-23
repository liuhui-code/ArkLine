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

## Packaged Windows Gate

The release-level gate runs a native Windows release executable through Tauri's
WebDriver bridge. It must not be replaced by jsdom, a development Vite page, or
a cross-compiled executable that is never launched.

Generate one of the deterministic ArkTS fixtures:

```powershell
pnpm fixture:performance -- --profile=medium --output=artifacts/soak-fixture
```

Run a short local protocol check or the required 30-minute release soak:

```powershell
$env:ARKLINE_INDEXER_ENABLED = "0"
pnpm perf:packaged:windows -- `
  --mode=smoke `
  --application=dist/ArkLine-windows-x64/ArkLine.exe `
  --fixture=artifacts/smoke-fixture `
  --report=artifacts/packaged-smoke-report.json

$env:ARKLINE_INDEXER_ENABLED = "1"
pnpm perf:packaged:windows -- `
  --mode=soak `
  --application=dist/ArkLine-windows-x64/ArkLine.exe `
  --fixture=artifacts/soak-fixture `
  --duration-minutes=30 `
  --report=artifacts/packaged-soak-report.json
```

The `windows-packaged-soak` workflow is manual and globally serialized so a
concurrent build cannot contaminate latency evidence. It defaults to the 20k
fixture and 30 minutes. Before that release workload, it launches a separate 1k
fixture for one interaction cycle. This smoke gate verifies the executable,
fixture marker and boundary files, Tauri/Edge/PowerShell tools, WebDriver
session, WebView timing capabilities, process-tree evidence, one real search,
and one real navigation. It does not evaluate long-run latency, queue drain, or
memory/WAL growth.

Once arguments and the report directory are valid, both smoke and soak write a
schema-v2 JSON report even when the harness fails. A startup failure report
identifies the failing platform/preflight/driver/session phase and preserves the
checks, driver exit state, bounded driver log, fixture, and executable evidence.
Its JSON artifact records:

- WebDriver dispatch, Find in Files result-visible, and Quick Open
  stable-paint p50, p95, and p99;
- W3C Event Timing, Long Animation Frames (LoAF), LoAF blocking time,
  long tasks, frame gaps, and visible app/editor crash surfaces;
- aggregate RSS, private bytes, handles, and threads for the ArkLine process
  tree, including sidecars and descendant WebView2 processes;
- optional JavaScript heap usage when the WebView exposes
  `performance.memory`;
- index queue depth, WAL/freelist bytes, writer wait/hold, shared SDK size, and
  indexer restart count;
- runner/CI identity, fixture marker, WebDriver capabilities, and executable
  size and SHA-256.

Strict acceptance rejects crashes, any WebDriver response failure, a run with
no real search result or no completed cross-file navigation, stale navigation,
remaining queue work, sidecar restarts, p95 above 100 ms, p99 above 250 ms, RSS
or private-memory growth above 512 MiB, supported JavaScript heap growth above
256 MiB, or workspace/shared-SDK WAL growth above 128 MiB. The strict runner
also requires Event Timing, LoAF, and process-tree capabilities. Zero Event
Timing or LoAF samples is valid: these APIs report slow work, so a responsive
run can have no entries. A missing capability is not valid because it leaves
the release claim unmeasured.

User-visible completion is measured on the renderer clock. Search completes
only after a result is visible; navigation completes only after the target tab
is visible and two animation frames have elapsed. WebDriver command duration is
kept separately to distinguish automation transport delay from WebView work.
The harness uses bounded observers and does not install a full-tree
`MutationObserver`: DOM mutations are neither React commit evidence nor a
low-overhead release metric. Native allocation tracing is reserved for a
targeted ETW/WPA diagnostic run because allocator instrumentation can perturb
the workload; the serial release soak uses process/private memory, optional JS
heap, WAL, and restart trends instead.

A passing hosted runner artifact is regression evidence; final release claims
still need the documented dedicated Windows machine class because hosted-runner
latency varies.

## Current Gate Status

The local `perf:runtime` command is a deterministic headless product-runtime gate. It proves
local input, cancellation, stale-result rejection, document preparation, and
latest-navigation behavior, but it does not measure Tauri IPC, native WebView
painting, SQLite lock wait, or packaged process memory. The packaged Windows
workflow now captures those boundaries; a successful 30-minute artifact has not
yet been recorded in this repository.
