# Frontend Responsiveness Convergence

**Status:** Local convergence complete; packaged Windows evidence pending
**Created:** 2026-07-31
**Parent architecture:** `2026-07-17-mature-ide-responsiveness-architecture.md`
**Related completion design:** `../specs/2026-07-26-completion-responsiveness-architecture.md`

## Objective

Keep input, search, file switching, navigation, and editing responsive while project, SDK,
semantic, and persistence work continues. The frontend must publish only current-generation
results and must remain usable when an enhancement layer is late or unavailable.

## Confirmed Failure Pattern

The project already has persistent indexes, worker processes, query generations, and synthetic
gates. The remaining responsiveness risk is at integration boundaries:

1. shell-derived state can still perform workspace-scale ranking during render;
2. file open can update the document, tree, tabs, indexing, and semantic layers in one interaction;
3. editor switches can recreate state or retain too many complete documents;
4. automatic and manual language features can acquire overlapping ownership;
5. timing evidence is split across UI latency, IPC latency, query diagnostics, and index events;
6. synthetic gates can pass while a packaged WebView stalls under concurrent background work.

## Target Flow

```text
Local input state
  -> latest-wins interaction generation
  -> bounded query or document-load broker
  -> publish current result
  -> activate editor/navigation target
  -> schedule semantic, tree reveal, and indexing enhancements

Interaction trace
  -> debounce
  -> broker/IPC
  -> file load
  -> editor state switch
  -> first paint
  -> deferred enhancement
```

## Invariants

1. React render never scans or ranks the complete workspace.
2. Input, selection, close, and navigation dispatch never await indexing or semantic readiness.
3. Every query and navigation transaction has a monotonic generation.
4. At most one running and one latest pending request exists per interactive query family.
5. Stale file reads, query results, and editor activations cannot mutate current UI state.
6. Tree reveal is a navigation enhancement; it cannot block editor activation.
7. Editor session retention is bounded by both entry count and document characters.
8. Full-document serialization is forbidden on the ordinary typing path.
9. Automatic completion has one production owner. CodeMirror owns popup, focus, keyboard,
   mouse, and editor transactions; the completion Broker owns candidates, filtering, ranking,
   generation rejection, and query diagnostics.
10. Diagnostics consume bounded immutable samples and do not make the shell subscribe globally.

## Budgets

| Interaction | Local target |
| --- | ---: |
| input event to visible text p95 | <= 16 ms |
| overlay close / selection movement p95 | <= 50 ms |
| warm Quick Open first page p95 | <= 100 ms |
| navigation dispatch p95 | <= 50 ms |
| warm file activation p95 | <= 200 ms |
| editor state application p95 | <= 50 ms |
| automatic completion request executions per 100-event burst | <= 2 |
| retained inactive editor sessions | <= 32 |
| retained inactive editor document characters | <= 2,000,000 |
| retained interaction traces | <= 40 |

Packaged Windows p95/p99 evidence is authoritative for release. Local Vitest and Node soak
results protect scheduling contracts but cannot close the packaged gate.

## Execution Plan

### Phase 1: Baseline And Ownership Map

- [x] Trace input, query, IPC, file load, editor switch, and enhancement boundaries.
- [x] Identify render-time workspace ranking and duplicate language request risks.
- [x] Preserve existing dirty work and avoid unrelated refactors.

### Phase 2: Unified Interaction Trace

- [x] Add a bounded interaction trace store with generation, phase, status, and duration.
- [x] Record Quick Open debounce, broker, and result publication.
- [x] Record document load, preparation, activation, semantic enqueue, and stale cancellation.
- [x] Record editor state application and next-frame restoration.
- [x] Add the trace timeline to Index Diagnostics without subscribing AppShell.
- [x] Attach request generation to IPC latency samples when present.

### Phase 3: Bounded Quick Open

- [x] Use the persistent readiness query for complete and partial workspaces.
- [x] Remove local whole-workspace ranking when a persistent broker is available.
- [x] Debounce by 40 ms and bound the first page to 20 candidates with a 250 ms deadline.
- [x] Cancel superseded backend search generations.
- [x] Keep keyboard selection bounded when result counts change.

### Phase 4: Navigation And Tree Decoupling

- [x] Append newly opened files incrementally instead of rebuilding and sorting the full tree.
- [x] Leave truncated lazy trees unchanged when a file opens outside the loaded branches.
- [x] Derive missing ancestor directories lexically and load them on demand for focus-file.
- [x] Keep file activation independent from tree reveal completion.

### Phase 5: Editor Session And Document Hot Path

- [x] Reuse CodeMirror `EditorState` for recently used files.
- [x] Bound session retention by count and total document characters.
- [x] Publish CodeMirror `Text` snapshots without immediate full-string conversion.
- [x] Coalesce semantic changes outside the input transaction.
- [x] Keep completion and signature context to the current line or bounded window.
- [x] Apply syntax and structural enhancements after initial activation.

### Phase 6: Language Feature Ownership

- [x] Route automatic and manual completion through the native CodeMirror owner in AppShell.
- [x] Keep candidate production, semantic filtering, ranking, and explain evidence in the Broker.
- [x] Share incremental semantic document acknowledgement with the native broker.
- [x] Cover mouse and keyboard acceptance, snippets, additional edits, replacement ranges,
      accessible labels, details, lazy resolution, Escape, Tab, and manual invocation.
- [x] Remove compatibility popup/controller imports from the production AppShell path.
- [ ] Delete the isolated compatibility implementation after packaged rollback confidence is
      recorded; it must not be reintroduced as a second production owner.

The unchecked cleanup item is source retirement, not permission to run duplicate production paths.

### Phase 7: Resource Pressure And Degradation

- [x] Bound Quick Open candidates, deadlines, traces, editor sessions, semantic snapshots, and IPC
      samples.
- [x] Preserve local editor behavior when persistent query or semantic layers fail.
- [x] Treat tree reveal, semantic synchronization, and editor enhancement as cancellable follow-up
      work.
- [ ] Project interaction trace overruns into a user-visible degraded-state summary.
- [ ] Feed sustained UI-latency pressure into background index scheduler throttling.

### Phase 8: Gates And Release Evidence

- [x] Add unit coverage for trace bounds and generation propagation.
- [x] Add query burst, file switch, editor render isolation, and stale navigation tests.
- [x] Keep the 500-line source-file gate and production build in the serial quality gate.
- [x] Keep packaged Windows WebDriver soak infrastructure and p50/p95/p99 report contracts.
- [ ] Capture a fresh packaged Windows run under concurrent indexing before claiming release-level
      completion.

## Verification Order

Run gates serially to avoid build/test contention changing latency evidence:

1. targeted frontend tests for changed controllers and stores;
2. `pnpm build`;
3. `pnpm check:line-count`;
4. `pnpm perf:runtime`;
5. `pnpm check:fast` when the machine is otherwise idle;
6. Windows packaged soak in CI or a Windows host.

## Rollout Decision

This slice improves the currently shipped interaction path. Native CodeMirror completion is the
production UI owner; further worker isolation remains capability-gated. A new implementation may
replace an old path only after it has equivalent behavior, bounded resource use, cancellation
evidence, and packaged-platform latency evidence.

## 2026-08-02 Completion Ownership Result

- AppShell now injects a single CodeMirror completion target. The compatibility controller and
  popup remain isolated source artifacts with no production import.
- CodeMirror owns popup visibility, keyboard and mouse selection, focus, acceptance, snippets,
  additional edits, and replacement transactions.
- The completion Broker owns candidate acquisition, member filtering, subsequence filtering,
  ordering, stale-generation rejection, empty-state reporting, and Query Explain evidence.
- Shell capture defers `Ctrl+Space`, `Escape`, and completion acceptance to CodeMirror while its
  autocomplete surface is active.
- Native completion tests cover explicit invocation, replacement ranges, details, lazy resolve,
  stable provider ranking, stale responses, keyboard movement, mouse acceptance, and snippets.

The traceable native release entry is:

```bash
gh workflow run windows-packaged-soak.yml \
  -f fixture_profile=medium \
  -f duration_minutes=30
```

The workflow packages `ArkLine.exe`, runs protocol smoke, a mixed interaction soak, and a pinned
real Harmony semantic scenario, then uploads `arkline-packaged-soak-evidence`. The run URL, commit
SHA, executable hash, and report summary belong in
`docs/performance-evidence/2026-07-24-windows-packaged-index-gates.md`. Local macOS checks do not
close this native WebView2 evidence item.

## 2026-07-31 Verification Result

Implemented and verified in this slice:

- 12 focused frontend files: 80 tests passed;
- AppShell automatic completion ownership: 3 focused tests passed;
- semantic Worker: 60 tests passed;
- frontend quality suite: 40 tests passed;
- production TypeScript, semantic bundle smoke, and Vite build passed;
- 871 checked source files remain at or below 500 lines;
- 5,000-file search burst: p95 11.996 ms, 2 committed requests, 0 stale applies;
- 5,000-file switch burst: p95 11.723 ms, jump dispatch p95 0.087 ms, 49 stale jumps rejected;
- core navigation and crash-boundary gate: 11 tests passed.

The repository-wide Rust gate remains nondeterministic under local load. Its 8-thread run reported
933 passed and 11 failed; a serial rerun reduced this to 942 passed and two existing failures. An
isolated rerun passed the index-worker reuse case. The remaining semantic-router fixture fails
before its test Worker reports startup and is outside the changed frontend paths. This is recorded
as quality-gate debt rather than counted as evidence against or for this slice.

## 2026-08-02 Final Local Convergence Verification

- The strict frontend gate passed all 18 stages and 1,399 tests in 752.244 seconds without a
  timeout or failed stage.
- The gate executes six non-AppShell shards with concurrency two, then 166 AppShell behavior tests
  in twelve serial batches. Every batch verifies its executed-test count, so an empty regex match
  cannot produce a false pass.
- The AppShell contracts now assert current-caret Definition requests, complete pointer sequences,
  CodeMirror's completion interaction delay, and the specific SDK settings save transaction rather
  than transient status text or competing persistence calls.
- Production TypeScript, Node scripts, Semantic Worker bundle smoke, and the 367-module Vite build
  passed. The existing large-chunk warning remains non-blocking.
- The 500-line gate passed 890 checked source files; `AppShell.tsx` is 498 lines. Whitespace checks
  passed.
- The Rust gate completed successfully: 959 library tests, one sidecar-equivalence integration
  test, and six sidecar-health integration tests passed with zero failures; 11 profiling or
  opt-in tests remained explicitly ignored.
- The strict 5,000-file runtime gate recorded search input/delete p95 at 0.312 ms, file switching
  p95 at 0.144 ms, and jump dispatch p95 at 0.006 ms. It rejected 49 stale jumps and applied only
  the latest request.
- Thirteen crash-boundary and navigation transaction tests passed.

These are local scheduling and behavior results. Packaged WebView2 latency, executable hash, and
real Harmony SDK evidence remain the only open release-level item in this plan.
