# Large Workspace Query And Index Convergence Plan

## Goal

Keep typing, file navigation, Search Everywhere, and Find in Files responsive while a medium or large workspace is still being discovered and indexed. Correctness is a hard requirement: a partial index must never turn an unscanned workspace region into a definitive `No matches` result.

## Industry Constraints

Mature IDEs keep foreground requests cancellable and independent from background indexing. IntelliJ exposes restricted index-dependent features while indexing, rather than returning fabricated certainty. VS Code isolates non-UI work and uses incremental, cancellation-aware language-service requests. ArkLine follows the same constraints:

- every query carries a generation and is cancelled by newer input;
- foreground results are streamed in bounded work pages;
- a negative result is final only after every eligible source has completed;
- background work yields only at resumable boundaries;
- persisted facts are published atomically and never overwritten by an older generation.

## Current Baseline

Implemented in this change:

- an empty parallel Find in Files probe now returns a filesystem continuation cursor unless the request was actually cancelled;
- budget exhaustion is no longer conflated with cancellation;
- text search no longer stops after a fixed eight pages. It stops on explicit cancellation, a non-advancing cursor, completion, or the 30-second request deadline;
- the stream sends every bounded page to the UI, preserving first-result responsiveness without dropping late workspace matches.

The existing physical discovery snapshot fallback remains the source of truth when discovery publication is incomplete.

## Target Architecture

```text
UI input
  -> foreground query broker (latest generation wins)
    -> ready content index
    -> physical workspace snapshot fallback
    -> resumable filesystem pages
  -> streamed batches / terminal confidence

workspace discovery
  -> FileIndex publication
  -> immutable DeepRefreshCatalog generation
       stable file_id + path snapshot
  -> DeepIndex checkpoints
       content -> stub paired range
       last completed file_id
  -> sidecar parse + SQLite publication
```

### 1. Foreground Query Lane

`Find in Files`, Double Shift, completion, and navigation must use a foreground lane with a dedicated worker reservation. A page has a small CPU/IO budget and may return `partial`, but must also return an advancing cursor. The broker discards stale results before they can reach React.

The UI must distinguish:

- `searching`: a page is running;
- `partial`: more eligible work remains;
- `complete with zero results`: every source finished;
- `cancelled`: newer input replaced the request;
- `deadline`: the result is incomplete and must not be reported as a miss.

### 2. Discovery And File Layer

Discovery publishes an incremental FileIndex, but the foreground fallback reads a cached physical snapshot while that publication is incomplete. This separates fast project opening from semantic completeness without hiding files from content search.

### 3. Durable Deep Work Units

Before applying time slicing to deep indexing, replace the current path-list continuation with a durable work unit. A path offset is not a valid checkpoint: discovery can sort, deduplicate, replace, or merge path lists between attempts. The checkpoint must instead reference an immutable catalog generation and stable file identities:

```text
DeepRefreshCatalog {
  root_path,
  catalog_generation,
  state: active | superseded | complete,
  entries: (file_id, path) ordered by file_id
}

DeepRefreshCheckpoint {
  root_path,
  task_key,
  catalog_generation,
  phase: content | stub,
  last_file_id,
  batch_last_file_id?
}
```

The content phase loads a bounded page after `last_file_id`, publishes it, and records that page's terminal `file_id` as `batch_last_file_id`. The stub phase reloads the same bounded identity range, then advances `last_file_id`. This makes restart and preemption safe without retaining workspace-sized path arrays in memory.

The current implementation persists `workspace_index_deep_refresh_catalogs`, `workspace_index_deep_refresh_catalog_files`, and `workspace_index_deep_refresh_checkpoints`. The deep continuation worker consumes catalog pages directly, applies one bounded layer phase, then advances the cursor only after publication. Catalog reads reject superseded generations. The remaining work is end-to-end proof that this path converges on a 20k Windows fixture without starving foreground requests.

### 4. Scheduler Policy

Once deep work is resumable, replace the fixed `32`/`128` background path policy with token-bucket time slices:

- active typing/navigation: 25-50ms slice, one foreground worker reserved;
- idle interaction: 100-250ms slice;
- no foreground queue: adaptive slice grows only when publication latency and memory stay within budget;
- a new foreground task preempts before the next sidecar chunk;
- background tasks use weighted fair scheduling so discovery, content, and stubs all make progress.

Path and byte caps remain guardrails, not the scheduler's primary clock.

### 5. Publication And Memory

Each sidecar chunk writes through the existing writer actor. The writer keeps transaction duration bounded, records lock hold time, and rejects stale generations. Search batches retain only visible result rows and previews are loaded lazily; this prevents the renderer from growing with a workspace-sized result set.

### 6. Diagnostics

Diagnostics must report enough evidence to separate a real stall from intentional yielding:

- running and queued work units, priority, phase, cursor, age, and last heartbeat;
- per-layer coverage: discovered, file-indexed, content-indexed, stub-indexed, failed;
- query explain: sources used, skipped source reasons, cursor progression, result count, and terminal reason;
- throughput and queue wait per stage; writer hold time; sidecar RSS; renderer result retention;
- first editor usable, first search batch, current-file ready, full background convergence, and slowest files.

## Implementation Stages

1. Complete query correctness: retain the current streaming cursor protocol and add 20k-fixture coverage for a match beyond the first interactive pages.
2. Create and supersede immutable DeepRefreshCatalog generations from full-refresh snapshots. Persist file-identity checkpoints and prove that content-core completes the catalog before stub and substring auxiliary stages begin. The ordered pipeline is specified in `2026-08-11-core-first-index-pipeline.md`.
3. Add a catalog-backed full-refresh continuation worker: construct a catalog once, read one page per scheduling turn, invoke one sidecar layer, checkpoint only after publication, and clear the checkpoint only when the catalog is exhausted. Implemented; awaiting packaged Windows convergence evidence.
4. Add supersede and recovery rules: a newer full refresh marks the old catalog superseded; startup resumes only active catalogs; maintenance removes completed/superseded catalogs after a retention window. Implemented; awaiting packaged Windows recovery evidence.
5. Add time-sliced fair scheduling only after Stage 3. Keep file-count caps as safety limits.
6. Add queue/throughput/memory attribution to Index Diagnostics and the packaged soak report.
7. Gate releases on a Windows 20k mixed workspace: zero false negative search results, no crash/unresponsive event, complete coverage, and explicit latency/memory budgets.

## Current Progress

The current implementation establishes the admission and evidence foundation before changing the deep worker:

- All indexed and semantic query envelopes now publish contract version `1` plus an explicit capability. `WorkspaceIndexReadiness` carries source, coverage, and fallback provenance. Query Explain exposes those fields so a result can distinguish project index, semantic current-file data, and an unavailable source.
- Packaged soak reports preserve discovery and per-layer freshness snapshots. The gate rejects a run whose final diagnostics cannot prove complete content coverage or whose sampling period does not observe content/stub progress; a row count alone is no longer accepted as proof.
- Scheduler admission derives `capability + affected scope` from every existing task without changing command payloads. Current-file completion, navigation, and visible-file work are latest-wins in both ready and delayed queues. Active changed-path cancellation now selects the same admission stream, so a newer navigation request cannot prevent cancellation of stale completion work. Reason remains an additional merge discriminator for compatibility with the existing lifecycle journal.
- Opening a workspace no longer submits the entire workspace file list as a visible-file foreground task. User-driven current-file work remains scheduled on demand.

Local validation completed: the full workspace-index Rust suite passes (`411` tests), the semantic-host suite passes (`45` tests), and the focused frontend quality gate passes (`43` tests). The production build type-checks app sources and completes successfully; formatting, whitespace, and source-file limit checks also pass (`911` files at or below `500` lines). The remaining release evidence is the packaged Windows 20k scenario, including `indexCoverage.coreReady`, latency, queue pressure, and memory measurements.

## Execution Plan And Acceptance

### Phase A: Trust The Observable State

1. Keep every query envelope on contract version `1` with an explicit capability.
2. Report source, coverage, fallback, requested generation, and served generation together.
3. Make the packaged report sample discovery and content/stub layers during the run, not only at exit.

Acceptance: a result, miss, or disabled action can identify its serving source and the exact missing or stale layer. A soak run fails when it cannot prove final content coverage or any deep-layer forward progress.

### Phase B: Protect The Interactive Lane

1. Classify index tasks by capability and affected scope before queue insertion.
2. Replace only same-capability current-file tasks; preserve unrelated navigation, completion, discovery, and SDK work.
3. Keep a single-file foreground result bounded. Suppress the workspace snapshot only for `VisibleFiles` batch work.
4. Keep cancellation selection on the same admission key used for queue coalescing.

Acceptance: rapid typing and navigation retain only their newest request, while foreground navigation still publishes its one-file readiness result and never triggers a workspace-sized React state update.

### Phase C: Merge Open-Document Truth

1. Reuse the existing semantic document queue and document-generation acknowledgement as the authoritative current-buffer layer. Completed for completion and definition.
2. Define per-capability source order: current buffer semantic facts, durable workspace facts, SDK facts, then explicit partial or fallback state. Completion and definition now preserve this provenance in their broker envelopes.
3. Reject a semantic response whose document version is older than the requested buffer version; do not overwrite a newer editor result with a durable index result. Completed for completion and definition.
4. Add query fixtures for an unsaved declaration, member completion, and definition resolution before the file index catches up. Definition has a stale-document-generation regression fixture; unsaved declaration and usage fixtures remain release-gate work.

Acceptance: completion and navigation act on the current editor buffer immediately, while project-wide queries still preserve durable-index provenance and never claim complete coverage from a single document.

Current implementation note: `query_language_definition` now accepts the same optional document version as completion. The editor synchronizes the active document before a definition request, the semantic worker receives that version in `gotoDefinition`, and the UI discards a reply whose `documentGeneration` does not match. The fallback index remains project evidence rather than a claim that an unsaved document is durable.

### Phase D: Bounded Background Convergence

1. Retain catalog-generation and file-identity checkpoints as the only deep-work cursor.
2. Bound each catalog dispatch to `32` paths / `8 MB` while preserving byte/path caps as safety rails. Foreground requests stay isolated by latest-wins admission and the scheduler's bounded foreground burst. The sidecar records each publication duration. A wall-clock mid-publication deadline remains a future refinement because it requires a transactional sidecar cancellation acknowledgement.
3. Reserve one worker for foreground tasks and apply weighted fair turns across discovery, content, stubs, and SDK work. The scheduler now grants one background turn after at most three foreground completion/navigation dispatches. This starts with background/deep/SDK priorities and keeps current-file work latest-wins.
4. Keep writer transactions bounded, measure lock hold/wait time, and defer maintenance behind active reads and foreground publication.

Acceptance: continuous foreground activity leaves a measurable background heartbeat and eventual content/stub progress; no task remains running without a heartbeat beyond its stall threshold.

Current implementation note: the foreground burst limit is intentionally a task-turn limit, rather than a wall-clock sleep. Each background task is catalog-checkpointed and bounded to one adaptive initial publication unit, so the fairness turn can be cancelled, resumed, and observed without rebuilding a workspace-sized state. A future wall-clock deadline can refine that unit only when sidecar cancellation confirms that no partial publication was committed.

### Phase E: Release Evidence

1. Run the Windows packaged 20k mixed-workspace scenario from a clean cache.
2. Gate on first editor usability, first result, navigation latency, no renderer crash/unresponsive event, bounded memory growth, complete content coverage, and observed deep-layer progress.
3. Archive the machine-readable report with the release candidate and fail the release on any missing evidence.

Acceptance: the gate supplies an auditable pass/fail record for the shipped package, rather than relying on local subjective responsiveness.

## Non-Negotiable Tests

- a late file match is found while discovery is partial;
- a cancelled query emits no later batch;
- an empty bounded probe continues using a cursor;
- a deep-index task resumes from the exact catalog generation and file-identity checkpoint;
- a complete content-core catalog pass precedes the stub and substring catalog passes;
- a superseded catalog is never resumed;
- a foreground navigation task is not blocked behind background work;
- a rebuilt index reaches full layer coverage on the 20k fixture;
- all source files remain at or below 500 lines.
