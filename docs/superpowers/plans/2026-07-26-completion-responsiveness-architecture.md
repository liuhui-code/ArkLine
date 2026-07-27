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
- [ ] Cache dependency closures without hiding external file changes.
- [ ] Add provider execution latency histograms.

Acceptance: unchanged dependency documents are not reparsed for every completion; SDK declaration
files are parsed once per SDK root; cache invalidation occurs when document content changes.

## Phase 5: Versioned Document Synchronization

- [x] Replace invalid leading large-file slices with cursor-aware content windows.
- [ ] Add protocol v4 `didOpen`, `didChange`, `didClose`, and `documentVersion`.
- [ ] Coalesce editor changes for 16-30 ms before synchronization.
- [ ] Make completion payload URI/version/position-only after the worker acknowledges the version.
- [ ] Replay bounded hot documents after worker restart.
- [ ] Test CRLF, Unicode positions, cursor after 80,000 characters, and unsaved imports.

Acceptance: the worker never answers a position against unrelated or stale content; ordinary typing
does not serialize a full document through Tauri.

## Phase 6: CodeMirror Completion Engine

- [ ] Add `@codemirror/autocomplete` as a direct dependency.
- [ ] Implement one immediate source and one asynchronous broker source.
- [ ] Use `validFor` to locally filter reusable result sets.
- [ ] Preserve stable selection when asynchronous candidates refresh.
- [ ] Implement snippet tab stops, commit characters, lazy resolve, and signature help.
- [ ] Apply completion and auto-import edits in one version-checked transaction.
- [ ] Retire custom global key interception and popup state after parity tests.

Acceptance: CodeMirror owns focus, keyboard navigation, scrolling, ARIA, and editor transactions;
backend failures cannot trap focus or prevent Escape/delete.

## Phase 7: Semantic Authority And Quality

- [ ] Define one ArkTS semantic authority and explicit index/SDK provider boundaries.
- [ ] Remove sequential short-circuiting between duplicate semantic engines.
- [ ] Add ArkTS virtual-document source maps for completion, definition, and edits.
- [ ] Build a real-project golden corpus for scope, type, member, ArkUI, SDK, overload, and import cases.
- [ ] Measure top-1, MRR@5, coverage, false-popup, acceptance, and cancellation rates.
- [ ] Remove the Rust string parser only after corpus parity.

Acceptance: no provider silently suppresses another required layer; quality and latency are measured
on the same fixed corpus and packaged Windows build.

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
