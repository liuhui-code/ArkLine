# Core-First Index Pipeline Design

## Context

The Windows packaged 20k-workspace soak is the authoritative regression
environment. On 2026-08-11 it indexed 3,680 content files in ten minutes and
8,875 in thirty minutes. The single SQLite writer published 924 content-core,
924 content-substring, and about 1,113 default publications in the ten-minute
run. Their P95 writer hold times were 198ms, 199ms, and 260ms respectively.

The current catalog cursor alternates content and stub work for every catalog
slice. Every content-core publication immediately also enqueues a detached
substring publication. This makes three independently useful layers compete
for a writer with one-write-at-a-time semantics. The result is measurable
progress, but it cannot meet the 20k core-content coverage gate while the user
continues to search, switch files, and navigate.

## Implementation Status (2026-08-11)

The following prerequisite work is implemented and covered by unit tests:

1. Content coverage carries persisted eligibility and policy-skip counts. A
   packaged-soak report now distinguishes eligible source files from binary,
   generated, and oversized files that reached an intentional terminal state.
   Missing or stale files still fail the coverage gate.
2. Foreground completion, navigation, and visible-file hints pass through
   backend admission lanes before they create UI activity or wake the worker.
   The lanes have short burst windows (400ms, 250ms, and 750ms respectively),
   while the scheduler remains the authority for pending-task coalescing and
   latest-wins replacement.
3. The diagnostics freshness table and exported diagnostic text expose
   eligible and skipped counts, so a partial index can be explained without
   treating a deliberate policy exclusion as an indexing failure.

The ordered core-first pipeline below is implemented. The remaining work is
runtime acceptance: Windows strict-soak must establish that it reaches coverage
within the deadline without regressing interaction latency, then the pinned
Harmony semantic smoke must pass on the same packaged workflow.

## Decision

Replace paired deep refresh with an ordered, resumable pipeline:

1. File catalog and file/symbol hot layer.
2. Content core for the complete stable catalog generation.
3. Stub/symbol data for the complete stable catalog generation.
4. Content substring/trigram auxiliary data for the complete stable catalog
   generation.

Each stage owns its own persisted cursor position. A stage advances only after
its last catalog page is committed; then the cursor switches to the next stage
at file identity zero. A newer catalog generation supersedes every unfinished
stage atomically.

## Publication Contract

The sidecar remains a producer and the writer actor remains the only SQLite
writer. Content preparation produces one artifact, but the requested publication
mode determines which layer consumes it:

- `CoreOnly`: write content lines, FTS state, generation, and mark substring
  state pending. Delete the artifact after the core commit.
- `StubOnly`: write declarations and symbol/stub state only.
- `SubstringOnly`: write trigram rows and mark the matching core generation
  ready. It never rewrites the content core.

`CoreOnly` is used for the first complete pass. It must not enqueue a detached
substring publication. This is the crucial throughput boundary. `SubstringOnly`
uses the existing writer actor's idle lane and is independently resumable after
the core and stub stages.

## Capability Contract

Every query consumes the least expensive ready layer and records the selected
capability version in its explain evidence.

- File navigation, current-file completion, and definition work from the file
  and hot semantic layers as soon as they are ready.
- Word/prefix text search works from content core FTS when the core stage has
  reached the queried file range.
- Arbitrary substring and literal-regex candidate acceleration requires the
  substring layer. Before it is ready, the query returns `partial` and uses its
  bounded verification/filesystem fallback instead of silently claiming full
  coverage.
- Usage and project-symbol capabilities stay partial until the stub stage has
  committed the relevant catalog generation.

The status bar and diagnostics must therefore be able to report `core ready,
auxiliary indexing` rather than presenting the entire workspace as either ready
or not ready.

## Scheduling And Recovery

The scheduler keeps its existing foreground burst fairness. It dispatches at
most one bounded background catalog slice at a time. The core stage receives
all background writer capacity except foreground reads and foreground
publications. Stub and substring never run concurrently with core for the same
catalog generation.

Persisted cursor state includes `content`, `stub`, and `substring` phases.
Existing two-phase checkpoints read as `content` or `stub`; no schema migration
is required because the phase column is text and unknown values are treated as
the safe `content` restart. Catalog supersession clears stale cursors and
publication artifacts using existing generation checks.

## Non-Goals

- Splitting the workspace store into several writable databases.
- Raising SQLite writer concurrency; SQLite WAL still serializes writers.
- Replacing the current semantic worker or query API.
- Claiming complete arbitrary-substring coverage before the auxiliary stage has
  reached the current generation.

## Acceptance Evidence

The implementation is accepted only when all of the following hold:

1. Unit and integration tests prove ordered `content -> stub -> substring`
   cursor transitions, core-only artifact cleanup, and substring-only commits.
2. Capability/query tests prove a core-ready but substring-pending workspace is
   explicitly partial rather than falsely complete.
3. `cargo test workspace_index_ --lib`, `pnpm build`, and the 500-line source
   gate pass.
4. Windows 20k packaged soak reaches verified content-core coverage within the
   thirty-minute deadline while retaining zero crash, unresponsive, stale apply,
   and search miss counts.
5. The same packaged workflow continues into and passes the pinned real Harmony
   semantic smoke after the strict soak passes.
