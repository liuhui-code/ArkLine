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

The current foundation persists `workspace_index_deep_refresh_catalogs`, `workspace_index_deep_refresh_catalog_files`, and `workspace_index_deep_refresh_checkpoints`. Catalog reads reject superseded generations. The worker is deliberately not switched until it consumes these pages directly; partial use alongside the existing path-list continuation would allow duplicated or skipped sidecar work.

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
2. Create and supersede immutable DeepRefreshCatalog generations from full-refresh snapshots. Persist file-identity checkpoints and prove that stub work replays exactly the preceding content range. Completed in the current foundation.
3. Add a catalog-backed full-refresh continuation worker: construct a catalog once, read one page per scheduling turn, invoke one sidecar layer, checkpoint only after publication, and clear the checkpoint only when the catalog is exhausted.
4. Add supersede and recovery rules: a newer full refresh marks the old catalog superseded; startup resumes only active catalogs; maintenance removes completed/superseded catalogs after a retention window.
5. Add time-sliced fair scheduling only after Stage 3. Keep file-count caps as safety limits.
6. Add queue/throughput/memory attribution to Index Diagnostics and the packaged soak report.
7. Gate releases on a Windows 20k mixed workspace: zero false negative search results, no crash/unresponsive event, complete coverage, and explicit latency/memory budgets.

## Non-Negotiable Tests

- a late file match is found while discovery is partial;
- a cancelled query emits no later batch;
- an empty bounded probe continues using a cursor;
- a deep-index task resumes from the exact catalog generation and file-identity checkpoint;
- a stub page replays only the exact preceding content page;
- a superseded catalog is never resumed;
- a foreground navigation task is not blocked behind background work;
- a rebuilt index reaches full layer coverage on the 20k fixture;
- all source files remain at or below 500 lines.
