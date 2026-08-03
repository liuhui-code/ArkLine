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
| Open Source Control with 400+ changes | first 100 changes <= 5 s; response is paged |
| Supersede Git status/history/diff queries | obsolete native Git process is cancelled |

## Local Smoke Commands

```bash
pnpm perf:runtime
node scripts/perf-search-input.mjs --files=5000 --strict
node scripts/perf-file-switch.mjs --files=5000 --switches=50 --strict
node scripts/perf-core-interaction.mjs --strict
pnpm test:frontend:gate
```

The scripts execute `tests/frontend/runtime-interaction-soak.test.tsx` through
Vitest and print `ARKLINE_PERF` JSON records. They import ArkLine's production
search input, search generation runtime, search session store, document load
coordinator, persistent document store, chunked text builder, and navigation
transaction runtime. They do not use a second benchmark-only search or file
switch implementation.

The runtime gate also executes the product interaction correctness suite. It covers
latest-navigation-wins behavior, cancellation of late document opens, failed opens
that must not move the caret or activate a broken document, and editor/app crash
boundaries that keep the shell visible. A correctness failure blocks the gate even
when latency budgets are green.

Reported evidence includes p50/p95/p99, React render commits, bounded candidate
count, cancellation and stale-result counts, document cache and pending-load
counts, notifications, and heap delta. Use the same machine, Node version,
fixture size, and command flags when comparing runs.

These local timings run against deterministic in-process adapters. They are a
correctness and regression screen, not evidence of WebView paint, Tauri IPC,
filesystem, SQLite, or semantic-worker latency. Only the packaged gate may be
used to make an end-user responsiveness claim.

## Release Policy

- A release candidate must include fresh performance output in `docs/performance-baseline.md`.
- A failing `--strict` run blocks release unless the regression is explicitly accepted.
- `pnpm perf:runtime --strict` is the required local Core Interaction Gate v1 entry;
  it must pass both latency budgets and correctness checks.
- `pnpm test:frontend:gate` is the repository-wide frontend gate. It streams
  verbose per-test progress, emits a heartbeat every 30 seconds, writes
  `artifacts/frontend-gate.json`, and terminates the runner after the documented
  15-minute hard timeout instead of leaving CI silent.
- If a real workspace behaves worse than the synthetic fixture, prioritize the real
  workspace result.
- Diagnostics must show IPC commands over 100 ms and UI long tasks over 100 ms.
- `pnpm test:rust` blocks release when Git query cancellation, bounded output,
  working-tree pagination, snapshot consistency, or the five-second first-page
  budget regresses.

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

Remove-Item Env:ARKLINE_INDEXER_ENABLED -ErrorAction SilentlyContinue
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

Release builds enable the packaged indexer sidecar by default. The smoke stage
sets `ARKLINE_INDEXER_ENABLED=0` to retain an explicit local-compatibility
rollback gate; the strict soak deliberately leaves the variable unset so it
tests the same default path used by an ordinary launch.

Once arguments and the report directory are valid, both smoke and soak write a
schema-v5 JSON report even when the harness fails. A startup failure report
identifies the failing platform/preflight/driver/session phase and preserves the
checks, driver exit state, bounded driver log, fixture, and executable evidence.
Its JSON artifact records:

- WebDriver dispatch, Find in Files result-visible, Quick Open stable-paint,
  editor input-visible, and editor scroll-frame p50, p95, and p99;
- causal interaction traces for editor input, search, and navigation, including
  parent/child IDs and phase timings for query, IPC/file open, selection apply,
  result apply, and visible commit;
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

Strict acceptance rejects crashes, repeated WebDriver response failures, a run
with no real search result, no completed cross-file navigation, no editor input,
or no editor scroll evidence, stale
navigation, remaining queue work, stalled index tasks, sidecar restarts,
renderer search or navigation p95 above 300 ms or p99 above 750 ms, editor input
or scroll p95 above 50 ms or p99 above 100 ms, W3C interaction timing p95 above
100 ms, any observed long task above 500 ms, RSS or private-memory growth above
512 MiB, supported JavaScript
heap growth above 256 MiB, or workspace/shared-SDK WAL growth above 128 MiB.
The strict runner also requires complete causal trace coverage with no errored
or unfinished trace, plus Event Timing, LoAF, and process-tree capabilities. Zero
Event Timing or LoAF samples is valid: these APIs report slow work, so a
responsive run can have no entries. A missing capability is not valid because
it leaves the release claim unmeasured.

Real-workspace scenarios additionally require at least one successful rendered
Ctrl+Click Definition and one receiver-member completion. Definition p95 must
remain at or below 200 ms and Completion p95 at or below 150 ms. Required
completion labels must be present and forbidden declaration-only labels must be
absent. These semantic checks are intentionally not synthesized for the scale
fixtures.

For a pinned real workspace, provide a versioned scenario manifest instead of
the generated-fixture naming convention:

```powershell
pnpm perf:packaged:windows -- `
  --mode=soak `
  --application=dist/ArkLine-windows-x64/ArkLine.exe `
  --fixture=C:\fixtures\PinnedHarmonyProject `
  --scenario=docs\performance-fixtures\core-loop-scenario.json `
  --sdk=C:\HarmonyOS\Sdk\openharmony `
  --duration-minutes=30 `
  --report=artifacts/real-project-core-loop.json `
  --strict
```

The schema-v2 manifest must declare the repository URL and license, source
revision, SDK identity, Find in Files queries, Quick Open targets, Ctrl+Click
source/target anchors, and member-completion anchors. Preflight rejects a Git
checkout whose `HEAD` or `remote.origin.url` differs from the manifest and
requires the explicit SDK directory. Content anchors must be visible near the
opened file's initial viewport; they prevent a changed tab title with stale
editor content from passing. The schema-v5 report records the manifest SHA-256,
actual SDK path, semantic candidates, and timings.

The checked-in CI scenario uses
`CoolMallArkTS@17b6899086a57a4d48448842a14f9e325e3e35a3` (MIT, roughly 490
ArkTS files) plus ArkLine's deterministic minimal SDK contract. This proves the
packaged real-project interaction path. A release-machine run must replace the
minimal SDK path with the matching installed HarmonyOS SDK before claiming full
SDK acceptance.

User-visible completion is measured on the renderer clock. Search completes
only after a result for the current query is visible; navigation completes only
after the target tab is visible. WebDriver command duration is kept separately
to distinguish automation transport delay from WebView work.
Each editor cycle enters a multi-character burst, observes the final visible
text, deletes the entire burst, and proves restoration. Each Find in Files cycle
deletes the exact query length, proves the input is empty, closes the palette,
and proves the query element is absent before continuing.
The harness uses bounded observers. A short-lived `MutationObserver` waits only
for the active search result surface and disconnects as soon as the requested
query is visible; it is readiness synchronization, not React commit evidence.
Native allocation tracing is reserved for a targeted ETW/WPA diagnostic run
because allocator instrumentation can perturb the workload; the serial release
soak uses process/private memory, optional JS heap, WAL, and restart trends
instead.

A passing hosted runner artifact is regression evidence; final release claims
still need the documented dedicated Windows machine class because hosted-runner
latency varies.

## Current Gate Status

The local `perf:runtime` command is a deterministic headless product-runtime
gate. It proves local input, cancellation, stale-result rejection, document
preparation, and latest-navigation behavior, but it does not measure Tauri IPC,
native WebView painting, SQLite lock wait, or packaged process memory. The
packaged Windows workflow captures those boundaries. Current run identities and
the exact strict verdict are recorded in
`docs/performance-evidence/2026-07-24-windows-packaged-index-gates.md`.

For commit `8b6e7d0d542b643af02a12489a3441c435b96e9d`, the serialized
hosted Windows gates passed both the 1k / 5-minute smoke workload and the
20k / 30-minute release workload. The 20k run completed 3,463 real
search/navigation cycles with search p95 `249.6 ms`, navigation p95 `95.3 ms`,
interaction p95 `32 ms`, 20,001 fully fresh indexed files, no final queue or
stalled tasks, no Worker restart, and no WAL growth. This is packaged regression
evidence; dedicated release-machine sign-off remains required.
