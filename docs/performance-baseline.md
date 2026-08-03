# ArkLine Performance Baseline

## Measurement Policy

Record the machine, Windows build, project size, and whether the ArkTS language
server is enabled for every benchmark run.

## MVP Targets

| Metric | Target |
|---|---:|
| Cold start to editable window | <= 2.5 seconds |
| Idle memory without LSP | <= 160 MB |
| Total memory with LSP | <= 340 MB |
| Quick Open result update | <= 50 ms |
| Search first result | <= 300 ms |

## Current Local Status

Local verification on 2026-06-19 from the macOS implementation environment:

- `pnpm test`: passing
- `pnpm build`: passing
- Frontend bundle split after lazy-loading CodeMirror:
  - main entry chunk: about `204 kB` minified, `64.5 kB` gzip
  - editor chunk: about `441.5 kB` minified, `149.4 kB` gzip
- Windows executable and installer: not yet verified from a Windows host or
  `windows-latest` CI run

## Semantic Smoke

Use the semantic-worker smoke harness before claiming local definition or
completion behavior is working on a machine.

Fixture verification:

```bash
pnpm smoke:semantic
```

Real workspace verification:

```bash
node scripts/smoke-semantic.mjs \
  --file /absolute/path/to/Index.ets \
  --definition-line 10 \
  --definition-column 5 \
  --completion-line 1 \
  --completion-column 1 \
  --expect-definition-path /absolute/path/to/Shared.ets \
  --expect-definition-line 1 \
  --expect-definition-column 17 \
  --expect-completion-label sharedSubmit()
```

Current local machine example against `/Users/liuhui/Documents/code/browser`:

```bash
node scripts/smoke-semantic.mjs \
  --file /Users/liuhui/Documents/code/browser/entry/src/main/ets/pages/Index.ets \
  --definition-line 64 \
  --definition-column 37 \
  --completion-line 1 \
  --completion-column 1 \
  --expect-definition-path /Users/liuhui/Documents/code/browser/entry/src/main/ets/utils/RdbUtils.ets \
  --expect-definition-line 4 \
  --expect-definition-column 22 \
  --expect-completion-label build()
```

Most recent local result on 2026-06-23 against `/Users/liuhui/Documents/code/browser` after rebuilding `semantic-worker/dist` from the latest source:

- definition target: `Index.ets:64:37 -> RdbUtils.ets:4:22`
- completion labels included: `@Entry`, `@Component`, `build()`
- timings:
  - `healthMs`: `156.72`
  - `definitionMs`: `8.34`
  - `completionMs`: `4.5`

Record the reported `healthMs`, `definitionMs`, and `completionMs` when running
against a real ArkTS project on the target machine.

## Release Gate

Do not mark MVP complete until Windows measurements are captured against a real
ArkTS workspace and attached here.

## Runtime Gate

Headless runtime smoke scripts:

```bash
pnpm perf:runtime
node scripts/perf-search-input.mjs --files=5000 --strict
node scripts/perf-file-switch.mjs --files=5000 --switches=50 --strict
```

Record the JSON output here for every release candidate. The scripts are model-level
checks; they do not replace packaged app profiling, but they catch large regressions
in search input and file switch projections before release.

Latest local product-runtime headless run on 2026-07-24:

```json
{
  "searchTypeDeleteClose": {
    "projectFileCount": 5000,
    "operations": 100,
    "candidateCount": 50,
    "commitCount": 2,
    "cancelCount": 102,
    "staleApplyCount": 0,
    "renderCommits": 5,
    "targetP95Ms": 50,
    "p50Ms": 0.1,
    "p95Ms": 0.25,
    "p99Ms": 0.373,
    "maxMs": 1.505
  },
  "fileSwitchJump": {
    "fileCount": 5000,
    "switches": 50,
    "jumpCount": 50,
    "cacheEntries": 16,
    "pendingLoads": 0,
    "staleJumpCount": 49,
    "appliedJumpCount": 1,
    "targetP95Ms": 300,
    "switchP50Ms": 0.054,
    "switchP95Ms": 0.103,
    "switchP99Ms": 0.843,
    "jumpDispatchP95Ms": 0.007
  }
}
```

This replaces the 2026-07-08 benchmark-only string scan and projection numbers.
The current fixture exercises production runtime modules, but remains a
headless model-level gate rather than packaged WebView evidence.

## Packaged Windows Evidence

The repository includes a `windows-packaged-soak` workflow that builds and
launches the release portable executable against deterministic 1k, 20k, or 100k
ArkTS fixtures. The release gate requires its default 20k / 30-minute run with
the release default indexer configuration, with no enablement environment
override.

The workflow first requires a schema-v5 `packaged-smoke-report.json` from an
isolated 1k fixture. That report
proves executable/fixture/tool preflight, WebDriver and WebView capabilities,
process-tree discovery, and one real search/navigation cycle; it is not latency
or stability evidence.

After the synthetic smoke, scale soak, and pinned real-project semantic smoke
pass, attach the schema-v5 reports
artifact details here with:

- runner image, OS release, commit/run identity, executable SHA-256, and fixture
  marker;
- duration plus WebDriver dispatch, search-result-visible, navigation
  stable-paint, editor input-visible, editor scroll-frame, Event Timing, LoAF,
  and frame-gap p95/p99;
- Event Timing, LoAF, JS heap, and process-tree capability flags;
- RSS/private/JS-heap and workspace/shared-SDK WAL growth;
- final queue state, pending loads, process/handle/thread maxima, and sidecar
  restart count;
- pinned repository/revision, explicit SDK path, Ctrl+Click target, member
  completion labels, and Definition/Completion p95 for the real-project report;
- the complete strict verdict and failure identifiers.

Zero Event Timing or LoAF entries is acceptable when the corresponding
capability is present; these observers emit only when work crosses their
threshold. Missing observer or process-tree capability means the packaged run
did not collect enough evidence and must not be recorded as passing.

If either harness stage fails after arguments and its report directory are
valid, retain its failure report. The `fatalError.phase`, preflight checks,
driver exit state, and bounded driver log are required diagnostic evidence; an
absent report is a workflow or build failure rather than a measured application
result.

The exact hosted Windows runs, executable hashes, failure history, and strict
metrics are archived in
`docs/performance-evidence/2026-07-24-windows-packaged-index-gates.md`.
Hosted-runner success is regression evidence; dedicated release-machine
sign-off remains required by the release policy.

Latest hosted Windows regression evidence for commit
`8b6e7d0d542b643af02a12489a3441c435b96e9d`:

- 1k / 5-minute strict gate:
  [run 30124746978](https://github.com/liuhui-code/ArkLine/actions/runs/30124746978),
  passed with search p95 `133.6 ms` and navigation p95 `81.4 ms`;
- 20k / 30-minute strict gate:
  [run 30125657721](https://github.com/liuhui-code/ArkLine/actions/runs/30125657721),
  passed with 3,463 successful search/navigation cycles, search p95
  `249.6 ms`, navigation p95 `95.3 ms`, and interaction p95 `32 ms`;
- all 20,001 content, symbol, and stub freshness records were ready; the final
  queue, stalled-task count, Worker restart growth, and WAL growth were zero;
- steady RSS/private-memory growth was `132,206,592 / 414,044,160` bytes and
  JavaScript heap growth was `95,775,756` bytes, all within strict limits.

This completes the hosted packaged regression measurement. It does not replace
the dedicated Windows release-machine sign-off required above.
