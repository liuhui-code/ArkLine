# Completion Responsiveness Execution Plan

**Goal:** Deliver a bounded, observable, latest-wins completion pipeline without regressing ArkTS,
ArkUI, SDK, CLI, navigation, or large-file behavior.

## Phase 1: Remove Deterministic Blocking

- [x] Make foreground completion indexing fire-and-forget.
- [x] Replace blocking `mpsc::recv_timeout` inside async Tauri commands with async timeout.
- [x] Add immediate keyword completion independent of semantic/index availability.
- [x] Add a one-running/one-pending frontend scheduler.
- [x] Add a 100-request burst regression test.

Acceptance: foreground indexing may remain unresolved while semantic/local completion returns; a
100-request burst executes only the original and latest operations.

## Phase 2: Semantic Request Actor

- [x] Move transport ownership to a dedicated semantic request actor.
- [x] Compact queued completion requests before execution.
- [x] Preserve non-completion request ordering.
- [x] Return generation-valid empty results for superseded queued completion work.
- [x] Stop retrying failed interactive completion requests.
- [x] Add actor queue compaction and process lifecycle tests.

Acceptance: callers no longer wait by contending on a transport mutex; stale queued completions do
not reach the worker; timeout recovery does not execute an obsolete completion twice.

## Phase 3: Diagnostics And Identity

- [x] Expose actor running, queued, completed, superseded, and failed counts.
- [x] Render actor evidence in Index Diagnostics / Semantic Host.
- [x] Forward frontend request generation into Tauri completion metadata.
- [x] Replace result-order IDs with stable completion identities.
- [x] Preserve candidates carrying explicit overload IDs.
- [x] Align the frontend protocol with the semantic worker `type` source.

Acceptance: diagnostics distinguish worker execution from queue pressure; reversing result order does
not change candidate identity; explicit overloads survive merging.

## Phase 4: Bound Worker Query Cost

- [x] Cache workspace symbol completion summaries by path and content.
- [x] Cache ArkUI SDK candidate groups by SDK root and component.
- [x] Filter SDK candidates by prefix after retrieving the cached component group.
- [x] Include provider symbol identity in worker results.
- [x] Add cache hit/invalidation tests.
- [x] Cache dependency closures without hiding external file changes.
- [x] Add provider execution latency histograms.

Acceptance: unchanged dependency documents are not reparsed for every completion; SDK declaration
files are parsed once per SDK root; cache invalidation occurs when document content changes.

Implementation note: the document store caches only complete resolved closure topology. Every hot
reuse validates dependency disk fingerprints; changed or deleted dependencies advance the durable
dependency generation, remove stale type-engine scripts, and rebuild the graph. Unresolved imports
disable topology reuse so a newly created dependency is discovered. The worker retains 128 samples
per provider and publishes integer-microsecond p50/p95/max evidence through the semantic supervisor
and Index Diagnostics.

Verification on 2026-08-02: Semantic Worker 64/64, strict frontend 1370/1370,
Rust 959 passed with 11 ignored, production build, runtime performance gate,
Rust formatting, whitespace, and the 500-line source gate all passed.

## Phase 5: Versioned Document Synchronization

- [x] Replace invalid leading large-file slices with cursor-aware content windows.
- [x] Add protocol v4 `didOpen`, `didChange`, `didClose`, and `documentVersion`.
- [x] Defer open synchronization for 32 ms and coalesce editor changes for 180 ms.
- [x] Make completion payload URI/version/position-only after the worker acknowledges the version.
- [x] Replay bounded hot documents after worker restart.
- [x] Retain 12 recently used semantic overlays and evict them through `didClose`.
- [x] Prepare the latest acknowledged document after a 120 ms idle delay.
- [x] Test CRLF, Unicode positions, cursor after 80,000 characters, and unsaved imports.

Acceptance: the worker never answers a position against unrelated or stale content; ordinary typing
does not serialize a full document through Tauri.

## Phase 6: CodeMirror Completion Engine

- [x] Add `@codemirror/autocomplete` as a direct dependency.
- [x] Implement one immediate source and one asynchronous broker source.
- [x] Use `validFor` to locally filter reusable result sets.
- [x] Preserve stable selection when asynchronous candidates refresh by reusing bounded candidate identities.
- [x] Implement native snippet tab stops and preserve commit characters in the adapter.
- [x] Add optional lazy resolve for completion documentation, deduplicated per candidate.
- [x] Add optional signature-help context parsing, cancellable broker requests, and version-checked tooltip state.
- [x] Connect TypeScript Language Service signature help to the semantic worker protocol.
- [ ] Connect ArkTS/SDK signature providers.
- [x] Resolve TypeScript completion details lazily and apply validated same-file import edits in one transaction.
- [x] Add a version-checked transaction builder for the primary completion and validated same-file import edits.
- [x] Connect the transaction builder to resolved same-file import edits.
- [ ] Route new-file, command, and multi-file completion edits through the workspace edit coordinator.
- [ ] Retire custom global key interception and popup state after parity tests.

Acceptance: CodeMirror owns focus, keyboard navigation, scrolling, ARIA, and editor transactions;
backend failures cannot trap focus or prevent Escape/delete.

## Phase 8: Foreground Latency Isolation

- [x] Start persisted-index and semantic work concurrently in the Tauri Broker.
- [x] Bound foreground semantic waiting to 80 ms for Completion and 180 ms for Definition.
- [x] Return indexed degradation when semantic work exceeds its interaction budget.
- [x] Abort the obsolete async waiter while allowing the isolated blocking worker to finish safely.
- [x] Record index duration, semantic outcome, and total Broker duration in query explain evidence.
- [x] Add deterministic deadline, idle preparation, overlay retention, and LRU eviction tests.

Acceptance: a cold type engine cannot hold an already available index result behind the semantic
worker timeout; recently visited documents retain semantic locality within a fixed memory bound;
preparation runs outside the editor activation and input paths.

Implementation note: the first rollout slice delivers the CodeMirror source and broker as an
optional editor injection. The main AppShell remains on the compatibility popup until parity tests
cover snippets, commit characters, import edits, keyboard ownership, and accessibility behavior;
this prevents two completion state machines from being active during the transition.

## Phase 7: Semantic Authority And Quality

- [x] Define one ArkTS semantic authority and explicit index/SDK provider boundaries.
- [x] Remove sequential short-circuiting between duplicate semantic engines.
- [x] Add ArkTS virtual-document source maps for completion and definition.
- [x] Route same-file TypeScript completion edits through the virtual-document maps.
- [ ] Route new-file, command, and multi-file semantic edits through the workspace edit coordinator.
- [ ] Build a real-project golden corpus for scope, type, member, ArkUI, SDK, overload, and import cases.
- [ ] Measure top-1, MRR@5, coverage, false-popup, acceptance, and cancellation rates.
- [ ] Remove the Rust string parser only after corpus parity.

Acceptance: no provider silently suppresses another required layer; quality and latency are measured
on the same fixed corpus and packaged Windows build.

The 2026-08-02 Phase 1-3 corpora establish the executable schema and eleven
core cases, including re-export aliases, generic chains, async return types,
ArkUI attributes, and synthetic SDK declarations. The real-project, overload,
import-edit, and packaged coverage in this phase remains open.

## Required Verification

```bash
pnpm test:semantic-worker
pnpm test:frontend
pnpm test:rust
pnpm build
pnpm check:line-count
pnpm perf:runtime
```

Additional stress scenarios:

- 100 rapid prefix changes while the first semantic request is blocked;
- repeated open/type/delete/Escape cycles;
- file switching during semantic execution;
- worker crash and hot-document replay;
- a cursor beyond character 80,000;
- 512 cached documents and SDK cache reuse;
- duplicate labels with distinct overload IDs;
- index building, partial, stale, and missing states.
