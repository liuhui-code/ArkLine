# Indexer Production Path Convergence

**Status:** Implementation complete; Windows packaged evidence pending
**Created:** 2026-07-31
**Parent architecture:** `2026-07-17-mature-ide-responsiveness-architecture.md`

## Objective

Make the ordinary packaged ArkLine launch use the same isolated indexer path as
the packaged performance gate. Preserve a deliberate local-compatibility
rollback without allowing a sidecar crash to move heavy content or Stub parsing
back into the desktop Host.

## Confirmed Gap

The Windows soak set `ARKLINE_INDEXER_ENABLED=1`, while `IndexerHostRuntime`
defaulted to disabled when the environment variable was absent. A normal release
therefore used a different execution path from the passing performance evidence.
An enabled but unavailable sidecar also returned `Unavailable`, after which the
worker synchronously ran local content and Stub refresh work.

## Runtime Policy

| Build or override | Indexer mode | Heavy Host fallback |
| --- | --- | --- |
| Release, variable absent | Enabled | Forbidden |
| Release, `ARKLINE_INDEXER_ENABLED=0` | Local compatibility | Allowed |
| Debug, variable absent | Local compatibility | Allowed |
| Any build, `ARKLINE_INDEXER_ENABLED=1` | Enabled | Forbidden |

Unknown environment values use the build default. This prevents a typo from
silently disabling isolation in a release build.

## Degradation Contract

1. File opening, editor input, lazy project browsing, and current-file hot
   indexing remain available.
2. Discovery may use a bounded 1,024-entry local chunk so a first-open project
   remains navigable.
3. Content and Stub refresh never fall back locally when isolation is enabled.
4. The affected task reports `partial` with a concrete sidecar error and retains
   the last durable deep-index snapshot.
5. Deep continuation retries wait for the sidecar lane backoff. A new foreground
   task wakes the wait immediately and keeps its priority.
6. Configuration changes schedule sidecar rediscovery rather than a Host root
   rescan.
7. `fallbackCount` records actual bounded local fallback; `degradedCount`
   records sidecar failures that left a capability partial.

## Execution Plan

### Phase 1: Enablement Contract

- [x] Extract a pure build-default and environment-override policy.
- [x] Enable the indexer by default in release builds.
- [x] Keep debug builds on the local compatibility default.
- [x] Preserve explicit enable and disable overrides.

### Phase 2: Host Work Removal

- [x] Delegate packaged open-workspace discovery instead of rescanning the root
      in the Host task.
- [x] Keep foreground navigation/completion limited to the current file layer.
- [x] Schedule deep work as a background continuation.
- [x] Stop local content and Stub fallback when isolation is enabled.
- [x] Route graph-affecting configuration changes through rediscovery.

### Phase 3: Degradation And Recovery

- [x] Add an explicit deferred deep-layer outcome.
- [x] Report partial readiness and retain durable deep rows on failure.
- [x] Separate degraded and actual fallback diagnostics.
- [x] Wait for sidecar backoff only when all pending work is background.
- [x] Wake immediately when new foreground work arrives.

### Phase 4: Equivalence And Release Gates

- [x] Preserve a local compatibility indexing regression test.
- [x] Add a real-binary sidecar contract fixture for discovery, content, and
      Stub declarations.
- [x] Keep an explicit-disable packaged smoke as the rollback gate.
- [x] Run the strict packaged soak without an enablement override.
- [ ] Capture a fresh Windows packaged report for the implementation commit.

### Phase 5: Documentation And Verification

- [x] Update README launch and rollback guidance.
- [x] Update packaged performance documentation.
- [x] Pass focused Rust and frontend tests.
- [x] Pass the production build and 500-line source gate.
- [x] Record any repository-wide gate debt separately from this slice.

## Acceptance

- A release build with no environment override reports an enabled indexer.
- Sidecar content or Stub failure publishes no new deep rows in the Host.
- Explicit local compatibility still produces content and Stub indexes.
- Foreground file readiness does not invoke a workspace scan.
- Sidecar failure leaves the task partial and the editor usable.
- The default-config packaged soak exercises discovery, content, search, and
  navigation without crashes, unbounded queues, or stale result application.

## Deferred Platform Hardening

Windows Job Object CPU and hard-memory limits remain a separate evidence-driven
slice. They improve process containment but are not required to correct the
default-path mismatch. They must not block this rollout or be enabled without
packaged measurements proving that the limits do not damage foreground latency.

## Verification Evidence

- Rust library gate: 951 passed, 0 failed, 11 ignored.
- Real sidecar equivalence fixture: 1 passed, covering discovery, content, and
  Stub publication through the compiled sidecar binary.
- Focused frontend coverage: Quick Open controller 10 passed, diagnostics 8
  passed, packaged-soak contract 13 passed, and the lazy-workspace AppShell
  navigation regression passed after waiting for the committed query generation.
- Production frontend build completed successfully.
- Runtime interaction gate passed: search p95 0.286 ms and file-switch p95
  0.167 ms in the deterministic harness.
- Rust formatting, whitespace, and the 500-line gate passed for 874 source files.

## Non-Blocking Repository Debt

- Some AppShell tests still emit React `act(...)` warnings from asynchronous
  fixture updates. They do not fail this slice but should be removed as test
  harness work.
- Vite reports an existing main-chunk size warning. Bundle partitioning remains
  separate from the indexer isolation contract.
- A fresh native Windows packaged-soak report remains required before release
  promotion; the workflow now exercises the default release policy without an
  enablement override.
