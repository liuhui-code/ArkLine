# Completion Responsiveness Architecture

**Status:** Active
**Created:** 2026-07-26
**Primary objective:** Completion may improve as semantic and index layers become ready, but typing,
deleting, closing the popup, and switching files must never wait for those layers.

## Confirmed Baseline Problems

1. Completion waited for foreground index scheduling before starting any provider.
2. The frontend discarded stale results but continued submitting backend work.
3. The semantic host held one transport mutex until the worker responded.
4. The semantic worker processed JSON-lines synchronously, so a cancellation message could not
   overtake a slow TypeScript or SDK operation.
5. A timeout terminated the worker and the manager immediately retried the already obsolete query.
6. Large files sent the first 80,000 characters while retaining the original cursor line and column.
7. Completion rescanned dependency documents and repeatedly sorted ArkUI SDK entries.
8. Candidate IDs depended on result order and label-only deduplication lost overload identity.

## Target Layers

```text
Editor input and CodeMirror state
  -> L0 Immediate completion (keywords, snippets, cached syntax; no IPC)
  -> L1 Latest-wins request scheduler (one running, one pending)
  -> L2 Tauri completion broker (generation, deadline, telemetry)
  -> L3 Workspace-affine semantic actor (single owner of language service)
  -> L4 Persistent symbol and SDK indexes (independent cancellable readers)
  -> L5 Resolve/apply lane (documentation, imports, snippets, signature help)
```

## Invariants

1. Input handlers never await indexing, filesystem traversal, SQLite writes, SDK parsing, or worker
   startup.
2. Automatic completion has at most one running request and one latest pending request per editor.
3. Superseded queued work is not executed. A superseded result cannot mutate popup state.
4. The semantic language service has workspace affinity and one owner; callers do not contend on
   its transport lock.
5. Foreground index scheduling is a background hint, never a query prerequisite.
6. Interactive query failures are fail-fast. Obsolete completion requests are never retried.
7. Every backend request carries a request generation. Every document query eventually carries a
   document version.
8. Large-document payloads must contain the cursor line. Sending an unrelated leading slice is
   forbidden.
9. Candidate identity is stable across filtering and reordering and preserves explicit overload IDs.
10. Missing semantic, project-index, or SDK layers degrade independently; local completion remains
    available.

## Scheduling Policy

Priority order:

1. editor input, selection, Escape, acceptance;
2. immediate local candidate filtering;
3. active-file completion and signature help;
4. current-file symbol index;
5. workspace and SDK candidate lookup;
6. foreground index hint;
7. background indexing and SDK construction.

Automatic completion uses a conservative trigger policy and a short debounce. Manual completion
may use a larger deadline but follows the same latest-wins queue. Provider results do not stream in
the first protocol revision because unstable partial ordering can change the selected candidate.

## Semantic Host Model

The host owns a request actor. The actor owns the transport and executes language-service work in
workspace order. Before executing the next request, it drains its queue and retains only the newest
completion request. Non-replaceable definition, code-action, and lifecycle requests retain order.

The current worker remains synchronous. Therefore cancellation has two levels:

- queued cancellation is immediate through request replacement;
- running cancellation is bounded by query optimization and deadline termination.

A later control-process/compute-thread split may provide hard preemption. It is not required until
measured semantic calls still exceed the latency budget after incremental document preparation and
caching.

## Document Contract

Transition protocol:

1. Current compatibility mode sends a cursor-aware bounded snapshot and request generation.
2. Protocol v4 adds `didOpen`, coalesced `didChange`, `didClose`, and `documentVersion`.
3. Completion then sends URI, position, request generation, and required document version only.
4. The broker rejects stale versions instead of silently reading disk or accepting truncated text.
5. Worker restart replays a bounded set of hot open documents before accepting semantic queries.

Changes should be coalesced for roughly one animation frame. Full-document synchronization is
allowed at open/recovery boundaries; normal typing uses incremental changes.

## Candidate Contract

Candidate identity is, in priority order:

1. provider completion ID;
2. provider + symbol ID + overload ID;
3. provider + kind + label + insertion + signature/detail + location.

The backend owns semantic validity, provider provenance, expected-type scoring, and import metadata.
The editor owns prefix/fuzzy filtering within a valid result set, keyboard selection, and stable
selection retention. Accepting a completion becomes one editor transaction containing the primary
edit, snippet tab stops, and validated additional import edits.

## Observability

Index Diagnostics exposes semantic actor state:

- running and queued requests;
- completed, superseded, and failed counts;
- worker restarts and consecutive failures;
- worker RSS, heap, uptime, and memory budget.

The next telemetry revision adds p50/p95/p99 queue wait and execution latency by provider. Metrics
must not store source text, prefixes, file contents, or symbol names.

## Performance Gates

| Measure | Target |
| --- | ---: |
| Input event to visible text | p95 <= 16 ms |
| Immediate local candidates | p95 <= 30 ms |
| Warm semantic first result | p95 <= 150 ms |
| Cold semantic result | p95 <= 500 ms |
| Queue cancellation/supersession | p95 <= 50 ms |
| Automatic requests executed during a 100-event burst | <= 2 |
| Semantic actor queued completions after burst | <= 1 |
| Worker restarts caused by stale completion | 0 |

Quality gates include top-1 accuracy, MRR@5, false-popup rate, overload retention, auto-import edit
correctness, and completion coverage for current scope, imported types, ArkUI, and SDK APIs.

## Rollout

1. Keep old popup behavior behind the current controller while replacing request scheduling.
2. Add shadow comparison for candidate sets and stable IDs.
3. Adopt CodeMirror autocomplete as the popup state/keyboard/apply engine.
4. Remove custom popup state only after keyboard, mouse, snippet, import, and accessibility parity.
5. Remove duplicate Rust string-based semantic completion only after the ArkTS worker and indexes
   meet the quality corpus gates.

Rollback is provider- and phase-specific. Index or semantic rollback must not remove L0 immediate
completion or restore synchronous foreground-index waiting.
