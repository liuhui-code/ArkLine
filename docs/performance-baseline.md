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

Latest local product-runtime headless run on 2026-07-17:

```json
{
  "searchTypeDeleteClose": {
    "projectFileCount": 5000,
    "operations": 100,
    "candidateCount": 50,
    "commitCount": 2,
    "cancelCount": 102,
    "staleApplyCount": 0,
    "renderCommits": 110,
    "targetP95Ms": 50,
    "p50Ms": 0.317,
    "p95Ms": 0.696,
    "p99Ms": 1.022,
    "maxMs": 3.81
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
    "switchP50Ms": 0.083,
    "switchP95Ms": 0.172,
    "switchP99Ms": 1.532,
    "jumpDispatchP95Ms": 0.01
  }
}
```

This replaces the 2026-07-08 benchmark-only string scan and projection numbers.
The current fixture exercises production runtime modules, but remains a
headless model-level gate rather than packaged WebView evidence.
