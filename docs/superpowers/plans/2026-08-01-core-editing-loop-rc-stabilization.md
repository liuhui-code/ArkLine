# Core Editing Loop RC Stabilization

**Status:** Implementation complete; native Windows evidence pending
**Created:** 2026-08-01
**Parent architecture:** `2026-07-17-mature-ide-responsiveness-architecture.md`

## Objective

Prove that the packaged application remains responsive and correct through the
three ordinary IDE paths that previously produced user-blocking failures:

1. editor input and scrolling;
2. file switching and navigation;
3. Quick Open and Find in Files while background indexing is active.

Completion quality, build orchestration, Device Log, and new index capabilities
are outside this stabilization slice. A failing core loop blocks those features.

## Evidence Layers

### Deterministic CI Fixture

The generated ArkTS workspace remains the strict scale gate. Files selected by
the soak contain enough source lines for real CodeMirror scrolling. Every cycle
opens a deterministic target, enters a multi-character burst, observes the
rendered text, deletes the burst, verifies restoration, and scrolls through
rendered content.

### Pinned Real Workspace

The packaged runner accepts an explicit workspace path and does not derive
correctness from generated file counts. A release candidate must additionally
run against a pinned, redistributable HarmonyOS workspace snapshot. Its source
revision, SDK identity, and fixture hash belong in the uploaded report. Local
user projects may provide diagnostic evidence but are not reproducible CI gates.

## Interaction Contract

- Input focus is acquired through the real CodeMirror content element.
- Input visibility is measured from renderer `beforeinput` to observed document
  text, independently from WebDriver transport time.
- The complete input burst is deleted and the original rendered length must be
  restored before the next file switch.
- Scroll evidence waits for two animation frames after changing the real
  CodeMirror scroller and requires a changed scroll position.
- Quick Open readiness requires both the committed query generation and a row
  containing the requested filename.
- Crash boundaries, a missing editor, an incorrect active tab, an edit mismatch,
  failed burst restoration, or leaked pending work are hard failures.

## Budgets

| Interaction | Strict packaged target |
| --- | ---: |
| Editor input to visible text p95 | <= 50 ms |
| Editor scroll to stable frame p95 | <= 50 ms |
| Search result visible p95 | <= 300 ms |
| Navigation target visible p95 | <= 300 ms |
| W3C interaction timing p95 | <= 100 ms |

Search and navigation p99 must remain at or below 750 ms; editor input and
scroll p99 must remain at or below 100 ms. Any observed renderer long task over
500 ms is a hard failure.

The long-term local input budget remains 16 ms. The first packaged gate uses a
50 ms hard threshold because it includes renderer observation and WebDriver
scheduling. Reports retain p50, p95, p99, and max for later tightening.

## Execution Plan

### Phase 1: Workload Boundary

- [x] Extract editor interaction automation from the near-limit soak runner.
- [x] Focus, burst edit, verify, delete, verify restoration, and scroll CodeMirror.
- [x] Keep all WebDriver commands bounded by explicit timeouts.

### Phase 2: Representative Fixture

- [x] Add deterministic long ArkTS files without making every indexed file large.
- [x] Version the fixture contract so stale generated workspaces are rebuilt.
- [x] Preserve exact file-name and content-search needles.

### Phase 3: Evidence And Verdict

- [x] Add editor input and scroll sample summaries to the report.
- [x] Add explicit edit, restore, scroll, crash, and stale-target counters.
- [x] Upgrade the report schema and preserve failure-report generation.
- [x] Fail strict soak when evidence is absent or exceeds its budget.

### Phase 4: Gates

- [x] Add focused model, automation-contract, and fixture tests.
- [x] Pass the runtime interaction gate and production build.
- [x] Pass whitespace and the 500-line source gate.
- [x] Wire a pinned MIT real Harmony project into the packaged Windows workflow.
- [x] Reject mismatched Git revision/repository and missing explicit SDK input.
- [x] Correlate editor input, search, navigation, file-open IPC, result apply,
  selection apply, and visible commit with bounded parent/child traces.
- [x] Replace the single-character workload with burst input/delete and prove
  Find in Files query clearing and palette closure.
- [x] Reject missing, errored, unfinished, or incomplete causal trace evidence.
- [ ] Run the native Windows small gate, then the 20k gate.
- [ ] Capture a passing schema-v5 pinned real-project semantic report.

The unchecked Windows item is release evidence rather than an implementation
substitute. It must execute the packaged `.exe` and WebView2 on a native Windows
runner; a macOS browser or unit-test result cannot close it.

## Architecture Decision Rule

No major subsystem migration follows from this plan by default. The first
repeatable failure determines the next change:

- writer or SQLite wait: move durable publication ownership;
- renderer or React work: reduce subscriptions and commit scope;
- file load or editor activation: improve document/session caching;
- semantic process work: consolidate semantic authority and snapshots;
- scheduler pressure: throttle background work from measured UI pressure.

The same replay must prove the improvement. Internal throughput without a core
interaction improvement is not acceptance evidence.

## 2026-08-02 Verification Note

The local deterministic gate remains useful for ordering, cancellation, and
stale-commit correctness, but its sub-millisecond adapter timings do not model
the packaged application. A manual browser replay on the generated demo found
no stale file activation or visible crash during burst search and repeated file
switching. This narrows no native root cause: the next Windows reproduction must
use the emitted causal traces to identify the first slow phase before changing
architecture.

## 2026-08-08 Candidate Freeze Verification

The Phase 8-10 working candidate passed the complete local stabilization loop
without producing a repeatable failure that would justify another hot-path
change:

- strict runtime search input/delete p95: `0.364 ms`, with 2 committed queries,
  102 cancellations, and no stale result application;
- strict runtime file-switch p95: `0.157 ms`, with 49 stale jumps rejected and
  one current jump applied;
- core navigation and crash-boundary coverage: 13 passed;
- changed search streaming and workspace API coverage: 32 passed;
- frontend quality and packaged-soak contract coverage: 41 passed;
- semantic Worker coverage: 71 passed, including a 12-case golden corpus with
  exact definition and receiver-member completion baselines;
- serial Rust library gate: 985 passed, 0 failed, and 12 ignored profiling or
  platform tests;
- production frontend and semantic-worker build passed;
- whitespace passed and 900 source files remained at or below 500 lines.

This is local candidate evidence, not release evidence. The working candidate
does not yet have a commit SHA or executable hash, so dispatching the hosted
Windows workflow would test an older revision. Freeze and publish the exact
candidate before running the native small gate, then the 20k / 30-minute gate.
Any native failure must be reproduced by the existing workload and repaired at
the first slow causal phase; a speculative scheduler, renderer, or indexing
redesign is outside this RC stabilization decision.
