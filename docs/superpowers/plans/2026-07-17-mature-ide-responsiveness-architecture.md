# Mature IDE Responsiveness Architecture

**Status:** Active long-term execution plan
**Created:** 2026-07-17
**Current phase:** Phases 1-4 core complete; Phase 5 process isolation and writer
observability active
**Primary objective:** Keep typing, search, file switching, navigation, and editor
rendering responsive while large project and SDK indexes are incomplete or busy.

## Evidence

This design follows established IDE and code-search architecture rather than
treating more memory or more threads as the primary fix.

- IntelliJ file-based indexes use key-to-file map/reduce indexes instead of
  rescanning every file for each query:
  <https://plugins.jetbrains.com/docs/intellij/file-based-indexes.html>
- IntelliJ keeps editing and non-smart features usable while project analysis is
  incomplete, exposes progress, and supports shared dependency indexes:
  <https://www.jetbrains.com/help/idea/project-analysis.html>
  <https://www.jetbrains.com/help/idea/shared-indexes.html>
- IntelliJ cancels and restarts long background read work when foreground writes
  need to proceed; cancellation checks must be cooperative and frequent:
  <https://plugins.jetbrains.com/docs/intellij/threading-model.html>
  <https://plugins.jetbrains.com/docs/intellij/background-processes.html>
- rust-analyzer uses per-file syntax trees and lazy, incremental, on-demand
  semantic queries. A function-body edit must not invalidate unrelated global
  facts:
  <https://rust-analyzer.github.io/book/contributing/architecture.html>
- TypeScript's Language Service API is designed around persistent hosts,
  per-script versions, snapshots, and incremental program reuse rather than a
  new compiler program for every editor query:
  <https://github.com/microsoft/TypeScript/wiki/Using-the-Language-Service-API>
  <https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API>
- Sourcegraph uses indexed candidate generation, trigram indexes, shards, mmap,
  bounded result pages, and early termination for large-scale code search:
  <https://sourcegraph.com/docs/admin/search>
  <https://sourcegraph.com/docs/admin/architecture>
- VS Code isolates extension work from the UI in extension hosts:
  <https://code.visualstudio.com/api/advanced-topics/extension-host>
- Tauri v2 supports versioned application resources and target-specific
  `externalBin` sidecars. Its official Node sidecar guide packages JavaScript
  into a standalone executable instead of requiring Node on end-user machines:
  <https://v2.tauri.app/develop/resources/>
  <https://v2.tauri.app/develop/sidecar/>
  <https://v2.tauri.app/learn/sidecar-nodejs/>
- POSIX process groups let the Host signal a Worker and all descendants as one
  lifecycle unit; Windows Job Objects provide the corresponding process-tree
  termination, accounting, priority, and resource-limit boundary:
  <https://pubs.opengroup.org/onlinepubs/009604499/functions/kill.html>
  <https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects>
- SQLite WAL permits readers and a writer to proceed concurrently. FTS5 provides
  prefix and trigram indexes suitable for candidate generation. SQLite permits
  only one simultaneous write transaction, so `BEGIN IMMEDIATE` is the durable
  cross-process arbitration boundary until the dedicated writer actor lands:
  <https://www.sqlite.org/wal.html>
  <https://www.sqlite.org/lang_transaction.html>
  <https://www.sqlite.org/fts5.html>

## Measured Baseline

Local debug profile on 2026-07-17:

| Workload | Result | Target |
| --- | ---: | ---: |
| 1k lightweight open | 829 ms | <= 1,500 ms |
| 1k exact Quick Open | 94 ms | <= 100 ms |
| 20k lightweight open | 0.98-2.96 s | <= 1,500 ms |
| 20k exact Quick Open | 0.57-1.78 s | <= 100 ms |
| 5k full background refresh | 31.4 s | background only |
| 5k slowest worker tick | 2.18 s | <= 50 ms foreground hold |

The current hot path clones an indexed workspace, scans every path, creates
normalized strings during each query, sorts every match, and truncates only at
the end. SQLite entity queries similarly load complete file and symbol tables.
The parse pool creates and joins native threads for every batch.

## Target Architecture

```text
UI / Editor
  -> Query Broker (generation, deadline, cancellation, first-page streaming)
      -> Hot File Catalog (immutable in-memory snapshot)
      -> Symbol Posting Index
      -> Content Search Index (SQLite FTS5/trigram)
      -> Semantic Query Engine (current-file and dependency driven)

Index Scheduler
  -> Persistent Query Pool
  -> Persistent Foreground Parse Pool
  -> Persistent Background Parse Pool
  -> Single SQLite Writer
  -> Versioned Shared SDK Index
```

### Architectural Invariants

1. UI event handlers never scan the workspace, parse code, query SQLite, or wait
   for index completion.
2. File and symbol queries perform indexed candidate generation before ranking.
3. Query cost is bounded by candidate and deadline budgets, not project size.
4. Every asynchronous result carries workspace generation and request generation.
5. Stale work is cancelled cooperatively and stale results cannot mutate UI state.
6. Current file and visible editor work always outrank project and SDK indexing.
7. Persistent data is updated by one writer and read through independent readers.
8. A partially built index remains queryable and reports its readiness honestly.
9. Index or semantic worker failure cannot crash or blank the app shell.
10. Performance claims require packaged Windows measurements at p50/p95/p99.
11. SDK-only and partially opened workspaces remain queryable when no project
    catalog has been persisted; a missing layer contributes an empty snapshot,
    not a whole-query failure.

## Index Layers

### L0 Workspace Catalog

- Stable `FileId` and normalized path.
- File name, stem, extension, module, source root, mtime, size, and content hash.
- Restored before directory reconciliation.
- Provides project tree and direct file opening without semantic indexes.

### L1 Hot File Search

- Immutable `Arc` snapshot published atomically.
- Precomputed lower-case path/name/stem and camel-case acronym.
- Prefix postings for one- and two-character file queries.
- Trigram postings for substring and fuzzy candidate generation.
- Recent/open/active-file context index.
- Bounded Top-K ranking; never sort all matching paths.
- Reuse the previous candidate set when the query is extended.

### L2 Content Search

- SQLite FTS5 content table with trigram candidate generation.
- File metadata remains in ordinary tables; FTS rows reference stable `FileId`.
- Literal and regex queries first derive indexed candidates, then verify matches.
- First page returns under a deadline; continuation cursor loads later pages.
- Unsupported regex patterns use cancellable sharded scanning, never UI-thread IO.

### L3 Stub And Symbol Index

- Per-file immutable syntax/stub summary.
- Name-to-symbol postings include kind, visibility, container, signature, and
  location.
- Editing a function body does not invalidate unrelated file/module summaries.
- Changed files publish deltas instead of rebuilding all symbol vectors.

### L4 Semantic And Reference Index

- On-demand queries keyed by content hash, project model generation, and SDK
  generation.
- Current file and direct dependency closure are evaluated first.
- References and type inference are incremental derived data.
- Missing or broken project configuration degrades precision but does not disable
  syntax, file search, local symbols, or editing.

### L5 SDK Index

- Stored separately from project indexes.
- Keyed by canonical SDK root, API version, schema version, and ArkLine version.
- Reused across workspaces and restored without reparsing the SDK.
- Project configuration contributes only SDK selection and dependency edges.

## Scheduling And Isolation

Priority order:

1. editor open, save, input, and local syntax;
2. active-file completion, definition, and navigation;
3. file and symbol queries;
4. visible-file and changed-file indexing;
5. project content and stub refresh;
6. references, dependency expansion, compaction, and SDK indexing.

Workers are persistent. Work units target 20-50 ms before yielding. Each loop
checks cancellation, deadline, generation, and UI-latency pressure. Repeated file
changes are coalesced by `FileId`; obsolete generations never enter the writer.

The long-term deployment boundary is an `arkline-indexer` sidecar. It owns index
memory, parse pools, and SQLite connections. The Tauri host supervises it through
a heartbeat and restarts it after a crash. UI queries use versioned RPC and may
fall back to the last durable snapshot.

### Indexer Process Contract

The migration uses a versioned JSON-lines protocol over stdio. Version 1 starts
with health negotiation and advertises only implemented capabilities. Later
methods are enabled independently so an older packaged sidecar fails capability
negotiation instead of accepting work it cannot complete.

Protocol v2 adds `stubRefreshChunk`: at most 64 workspace-owned paths per
request, no source content or AST payload, explicit scheduler and indexed
generations, and background priority only. The Host still owns foreground work
while this method remains behind `ARKLINE_INDEXER_ENABLED=1`.

The ownership boundary is:

- Host owns UI commands, latest-request cancellation, user-visible scheduling
  intent, diagnostics projection, and read-only query connections.
- The final consolidated Indexer owns discovery cursors, parse pools, the durable
  task journal, schema migration, the single SQLite writer, compaction, and SDK
  artifact production. During Phase 5 migration, discovery, content, and stub
  lanes are separate processes and SQLite remains their write arbiter.
- Each work item carries a structured idempotency key of canonical root,
  task kind, generation, and reason. Replayed work may publish the same terminal
  result but may never commit an older catalog generation.
- Status events are monotonic: queued, running, then exactly one of ready,
  partial, failed, cancelled, or superseded. Heartbeats do not imply progress.
- A write response is acknowledged only after its transaction and task-journal
  terminal state commit together. Host process death therefore cannot create a
  reported-ready but missing catalog.
- Cancellation is cooperative for parsing and mandatory before writer commit.
  Foreground reads never share the command channel or wait behind write work.
- During rollout, unavailable or incompatible sidecars leave the existing local
  executor active. Production switches one task kind at a time only after
  equivalence, crash-replay, and packaged-platform gates pass.

## Query Interaction Contract

- Input state updates synchronously and locally.
- File/symbol debounce: 30-50 ms; content debounce: 80-120 ms.
- Escape, delete, arrow keys, click, and Enter never wait for backend work.
- Latest request wins; previous request cancellation is best effort but immediate.
- Keep prior results visible until the new first page arrives.
- Return 20-50 initial results, followed by explicit continuation pages.
- Preview starts only after selection is stable for 150-250 ms.
- File queries support one character through prefix postings. Content trigram
  queries require three characters unless an exact/prefix fallback is available.

## Execution Phases

### Phase 1: Hot FileSearchIndex

- [x] Introduce immutable file search entries with precomputed normalized fields.
- [x] Add prefix/stem-trigram candidate postings and bounded Top-K ranking.
- [x] Stop cloning the complete `IndexedWorkspace` for every query.
- [x] Publish replacement catalog snapshots atomically after add/remove operations.
- [x] Make the existing 20k strict gate pass.
- [x] Add a 100k report-only benchmark.

Acceptance:

- 20k exact/prefix/fuzzy Quick Open p95 <= 50 ms in release profile.
- 100k Quick Open p95 <= 100 ms in release profile.
- Query allocations are proportional to candidate limit, not workspace size.

#### Phase 1 Result

Measured in a local Rust debug build on 2026-07-17 after the hot index was
integrated into product queries:

| Workload | Before | After |
| --- | ---: | ---: |
| 20k lightweight open | 0.98-2.96 s | 284 ms |
| 20k exact Quick Open | 0.57-1.78 s | 1.13 ms |
| 100k hot index build | not measured | 1.70 s |
| 100k mixed Quick Open | not measured | p95 1.99 ms / p99 2.02 ms |

The strict 20k gate passes. The implementation precomputes file search fields,
uses exact/prefix/acronym/stem-trigram postings, scores at most 512 candidates,
and publishes the immutable index through `Arc`. Directory-qualified queries
filter against the normalized path without restoring a workspace-wide scan.

Catalog changes currently construct a replacement immutable snapshot on the
background update path. Query readers remain lock-short and always see a
consistent generation, but structural-sharing deltas are deferred until
profiling shows replacement build cost is material under watcher bursts.

Phase 2 may start only with the 20k strict gate remaining green. Its first work
package is: query generations and deadlines, real input debounce, cooperative
cancellation, persistent named worker pools, reserved foreground capacity, and
watcher-event coalescing. The UI interaction gate must be added before replacing
the existing worker implementation.

### Phase 2: Query Broker And Persistent Workers

- [x] Restore real debounce instead of dispatching every keystroke.
- [x] Implement shared deadline, generation, and cancellation tickets.
- [ ] Add prior-candidate reuse only after a profile proves it improves the
  already bounded hot file query without changing ranking correctness.
- [x] Replace per-batch `thread::spawn + join` with persistent named pools.
- [x] Reserve capacity for foreground query and active-file parsing.
- [x] Coalesce changed-file and watcher events.

Acceptance:

- Search input/delete p95 <= 16 ms while background indexing runs.
- Search close and file jump p95 <= 50 ms.
- No index worker tick prevents a foreground task for more than 50 ms.

#### Phase 2 Core Result

Implemented on 2026-07-17:

- Search Everywhere commits local input after 40 ms; content search commits
  after 100 ms. Draft typing and deletion do not rerender result rows.
- A shared backend Query Broker issues monotonic generation/deadline tickets.
  Search Everywhere uses a 250 ms deadline and content search uses a 1,500 ms
  first-page deadline. Cancel, newer generation, and deadline all share the same
  cooperative stop predicate.
- Product entity and content commands carry the frontend request generation into
  the backend. Compatibility commands remain available for the IDE CLI surface.
- ArkTS parse workers are named, reusable across batches, panic-isolated, and
  priority-aware. With foreground reserve enabled, background parsing cannot
  consume the final foreground lane.
- The index manager worker is named and reused across bursts, with 30-second idle
  retirement instead of 250 ms thread churn.
- Watcher changes continue to coalesce and deduplicate by workspace and reason.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Rust library tests | 712 passed / 10 ignored / 0 failed |
| Foreground parse dispatch while background is blocked | <= 50 ms |
| 20k lightweight open after Phase 2 | 456 ms |
| 20k exact Quick Open after Phase 2 | 1.63 ms |
| TypeScript and production Vite build | passed |
| Targeted Search Everywhere / Find in Files AppShell tests | 7 passed |

The local tests prove bounded dispatch and stale-result safety, not packaged
Windows p95. Search input/delete and close/jump p95 acceptance remains open until
Phase 6 records release-build traces under concurrent indexing. Prior-candidate
reuse is also intentionally open: the 100k hot query is already about 2 ms p95,
and a truncated reuse set can silently damage ranking correctness.

### Phase 3: Durable Content And Symbol Indexes

- [x] Add a globally bounded WAL reader pool and serialized single-writer gate.
- [x] Add FTS5/trigram content index and stable `FileId` schema.
- [x] Query symbol postings directly instead of loading all symbols.
- [x] Add bounded first-page and continuation cursors.
- [x] Run `PRAGMA optimize` after full index/schema maintenance, not incremental saves.

Acceptance:

- 100k-file literal search first page p95 <= 150 ms after warm restore.
- Regex search remains cancellable and UI responsive.
- Incremental save indexes one file without project-wide table replacement.

#### Phase 3 Core Result

Implemented on 2026-07-17:

- Workspace SQLite connections now share a five-second busy timeout, WAL mode,
  `synchronous=NORMAL`, a four-connection global reader bound, and a per-store
  writer gate. Read connections are `query_only` and returned only after any
  SQLite progress handler is removed.
- Full and incremental catalog persistence, content indexing, schema migration,
  restore, and entity reads use the common connection layer. Full maintenance
  runs `PRAGMA optimize`; incremental saves do not pay that cost.
- `workspace_file_identities` assigns a stable integer `FileId` to each
  workspace path. Ordinary content rows and both FTS tables reference it, and
  changed-file updates retain the same identifier.
- Content search uses token-prefix FTS first and trigram FTS for three-or-more
  character substrings. FTS first pages stream in stable row order without a
  full-result `bm25/path` sort. One- and two-character/case-sensitive fallback
  scans are interruptible through SQLite's progress handler.
- Symbol search persists normalized name, initial, acronym, and trigram
  postings for stub and entity origins. It ranks at most 512 database-selected
  candidates; legacy whole-table loading remains only as a compatibility path
  for pre-posting stores until rebuild.
- Existing candidate and text-search cursors cap page size and return
  non-repeating continuation pages.
- Schema domains now use `catalog=2`, `content=2`, and `symbol=3`; older stores
  are reported as rebuild-required rather than silently treated as current.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Rust library tests | 719 passed / 11 ignored / 0 failed |
| 20k lightweight open | 467.52 ms |
| 20k exact Quick Open | 1.74 ms |
| 100k hot file index build | 2.38 s |
| 100k hot file query p95 / p99 | 2.64 ms / 2.74 ms |
| 100k persisted content warm first page p95 | 26.96 ms |
| TypeScript and production Vite build | passed |

The 100k content gate uses 100k distinct persisted paths/rows in the real WAL
SQLite schema and the product query path. It is a first-page storage/query gate,
not a claim that parsing 100k source files is complete. Packaged Windows p95,
memory/WAL soak, and UI render-commit evidence remain Phase 6 responsibilities.
The writer gate serializes current in-process writers; the dedicated sidecar
writer actor and crash recovery belong to Phase 5 process isolation.

### Phase 4: Incremental Semantic Engine

- [x] Separate syntax inputs, project model, stubs, definitions, types, and refs.
- [x] Key derived queries by content and dependency generations.
- [x] Prioritize active-file dependency closure.
- [x] Persist/reuse SDK indexes independently from project indexes.

Acceptance:

- Current-file syntax readiness <= 100 ms after edit.
- Completion first useful result p95 <= 150 ms.
- Definition p95 <= 200 ms when required layers are ready.

#### Phase 4 Core Slice Result

Implemented on 2026-07-17:

- The semantic Worker no longer recursively enumerates and synchronously reads
  every `.ets`/`.ts` file for each completion or definition. A session-owned,
  bounded document store loads the active document and recursively resolved
  relative-import closure only. The closure is capped at 256 documents/8 MiB;
  the shared cache is capped at 512 documents/16 MiB with LRU eviction.
- Active unsaved content has a monotonic content generation. Imported file
  changes advance a dependency generation. Completion and definition cache keys
  include method, path, position, content generation, and dependency generation.
- The Tauri semantic host assigns content generations for the lifetime of the
  Worker session. The Worker returns the served generation and the host rejects
  missing or mismatched generation evidence. Frontend request IDs continue to
  prevent superseded responses from mutating UI state.
- Global project symbols are not rebuilt in the semantic Worker. They remain in
  the persisted Rust symbol posting index; the Worker handles current-file,
  imported-dependency, and on-demand ArkUI syntax semantics.
- Semantic responses now expose current path, content/dependency generations,
  document/query cache hits, loaded document count, and syntax readiness. This
  metadata is the protocol basis for later Current File Readiness diagnostics.

Strict local gates use the real Worker session with 1,000 unrelated source files:

| Gate | Result |
| --- | ---: |
| Current-file + dependency syntax preparation | < 100 ms |
| Completion warm-query p95 | < 150 ms |
| Definition first query | < 200 ms |
| Loaded synchronous semantic documents | 2 |
| Semantic Worker tests | 41 passed / 0 failed |
| Semantic host generation mismatch test | passed |
| Full Rust library tests | 737 passed / 11 ignored / 0 failed |
| TypeScript and production Vite build | passed |

This completes the dependency-driven query slice, not the whole semantic
engine. Incremental type/reference derivation, persisted per-file semantic
readiness, and packaged Windows p95 measurements remain open. The limits are
safety bounds rather than permission to routinely load the full closure; later
profiling should lower typical work through project-model dependency edges and
finer-grained syntax inputs.

#### Phase 4 Shared SDK Result

Implemented on 2026-07-17:

- SDK symbols now publish to an application-level WAL database. Production paths
  use `%LOCALAPPDATA%/ArkLine` on Windows, `~/Library/Caches/ArkLine` on macOS,
  and `$XDG_CACHE_HOME/arkline` or `~/.cache/arkline` on Linux. The
  `ARKLINE_SHARED_SDK_INDEX_DIR` override supports managed and CLI deployments.
- Immutable artifact identity includes canonical SDK root, API version, SDK API
  manifest fingerprint, and parser version. Workspace catalogs persist only the
  active artifact binding and readiness metadata.
- Full and chunked builds use atomic `building -> ready` publication. A process
  wide single-writer gate serializes schema and write transactions; WAL readers
  remain independent. Phase 5 moves this gate into the sidecar writer actor.
- A ready artifact is bound and reused before SDK parsing starts. Two independent
  workspace catalogs can bind the same artifact without copying SDK symbol rows.
- Search, completion, definition, symbol identity/usages, reference indexing,
  diagnostics, and layer readiness query the shared repository first. Existing
  workspace SDK tables remain a one-release dual-read/dual-write fallback for
  rollback and corrupt-artifact recovery.
- Shared symbols persist normalized names, camel-case acronyms, and trigram
  postings. Three-character and longer non-prefix queries generate at most 512
  candidates from postings instead of scanning the SDK symbol table.
- Metadata records the expected symbol count. Missing/truncated tables or partial
  writes fail integrity validation and automatically fall back to the last
  workspace-local snapshot. Failed replacement transactions preserve the old
  ready artifact.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Two workspaces reuse one artifact without local symbol copies | passed |
| Repeated full SDK task skips parsing after ready publication | passed |
| Concurrent artifact append through single writer | passed |
| Failed replacement preserves previous ready snapshot | passed |
| Corrupt shared artifact falls back to workspace snapshot | passed |
| SDK switch exposes active artifact only | passed |
| 5k-symbol non-prefix trigram query warm p95 | < 100 ms |
| Full Rust library tests | 737 passed / 11 ignored / 0 failed |
| Semantic Worker tests | 41 passed / 0 failed |
| TypeScript and production Vite build | passed |

#### Phase 4 Per-File Semantic Readiness Result

Implemented on 2026-07-17:

- Added the versioned `semantic_layer` schema domain and
  `workspace_semantic_file_layers`. Every file/layer row records explicit
  status, source generation, dependency generation, producer version, result
  count, error, and publication time. A successful zero-result query is now
  distinguishable from a layer that never ran.
- Disk/project layers publish independently for `syntax`, `projectModel`,
  `definitions`, and `references`. `types` remains explicitly `missing` until a
  real type engine publishes evidence; no symbol-table heuristic claims it is
  ready.
- Editor Worker generations publish separately as `editorSyntax` and
  `editorDefinitions`. Editor content generations are never compared with
  project task generations, so unsaved content cannot overwrite or be rejected
  by an unrelated disk-index generation domain.
- Changed files mark existing layer generations stale before replacement;
  deleted files remove their states. Older asynchronous generations cannot
  overwrite newer evidence. Parser errors and parser worker failures publish a
  failed syntax row without blocking successful files.
- Semantic Worker evidence uses a one-way background publisher. Completion and
  definition return on the query path before SQLite metadata publication, so
  observability does not add a writer wait to typing or navigation latency.
- Current File Readiness and the layer report now expose each semantic layer.
  Query Explain uses explicit generation evidence and correctly reports
  `notFound` when a ready layer produced zero results, instead of recommending a
  pointless rebuild because a result table had no row.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Full Rust library tests | 737 passed / 11 ignored / 0 failed |
| Semantic Worker tests | 41 passed / 0 failed |
| Targeted diagnostics UI tests | 23 passed / 0 failed |
| TypeScript and production Vite build | passed |
| Production and embedded test sources over 500 lines | none |

The repository-wide frontend suite is not a clean release gate yet: unrelated
legacy hotkey, bottom-tool, build, store, and device-log tests include existing
15-second timeouts or stale assertions. Phase 6 must establish a deterministic,
sharded release suite before using that command as performance evidence.

#### Phase 4 Incremental Type Engine Result

Implemented on 2026-07-17:

- Added one persistent TypeScript Language Service per active workspace. Script
  snapshots are updated only when content changes; the registry retains at most
  four workspaces and each engine retains at most 512 scripts/16 MiB with LRU
  eviction. It consumes only the active document's bounded import closure, not a
  recursive workspace scan.
- Type-dependent completion and definition use the real TypeChecker. Lightweight
  ArkTS keywords, stubs, SDK declarations, and direct imported declarations are
  queried first. The TypeChecker starts only for receiver/member completion or
  a definition miss, keeping ordinary typing and navigation off its cold path.
- `.ets` documents use a position-preserving adapter (`struct` to `class`) and
  explicit `.ets` module resolution. This enables useful TypeScript-compatible
  member semantics, but ArkTS readiness is intentionally `partial`; only native
  `.ts` documents report `ready`. Proprietary ArkTS/ArkUI behavior continues to
  use dedicated providers.
- Query cache identity now includes content generation, dependency generation,
  type-engine version, and type-program generation. Unchanged snapshots reuse
  both the Language Service program and query result; a changed dependency
  invalidates the result without rebuilding unrelated workspace indexes.
- Worker responses publish `editorTypes` asynchronously alongside
  `editorSyntax` and `editorDefinitions`. Ready and partial evidence, source and
  dependency generations, and zero-result counts remain distinct in Current
  File Readiness.
- A missing source file now reports syntax/type unavailable instead of claiming
  a successful empty parse.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Semantic Worker tests | 46 passed / 0 failed |
| Type completion and cross-file typed definition | passed |
| Dependency generation invalidates type result | passed |
| ArkTS adapter reports partial, never ready | passed |
| Four-workspace LRU bound | passed |
| Existing 1k-unrelated-file semantic latency gate | passed |
| Semantic host readiness/session targeted tests | 8 passed / 0 failed |
| Production and embedded test sources over 500 lines | none |

Phase 4 does not persist the TypeScript program graph: it persists readiness and
generations while the bounded Language Service cache remains disposable memory.
This follows an on-demand semantic model and avoids a second durable source of
truth. The current Tauri process launcher still relies on a development-tree
Worker entry and root `typescript` runtime. Phase 5 must package the Worker and
runtime as a versioned sidecar/resource, then add watchdog, restart, protocol
negotiation, and memory enforcement before release claims are valid.

Workspace-local SDK fallback rows can be removed only after a packaged release
proves migration and rollback telemetry on existing installations.

### Phase 5: Indexer Process Isolation

- [x] Bundle Worker JavaScript and runtime dependencies as a versioned resource.
- [x] Require a host/Worker protocol-version handshake.
- [x] Package a target-specific standalone semantic `externalBin`.
- [ ] Move indexing and semantic work into `arkline-indexer` sidecar.
- [x] Add response heartbeat, bounded restart backoff, protocol version, and
  soft memory-budget recycling.
- [x] Add an independent low-frequency idle watchdog that never queues behind
  foreground semantic work.
- [ ] Add OS-level hard process memory enforcement.
- [x] Recover durable document generations and bounded hot content after Worker
  restart.
- [x] Keep UI and last-open editor usable when the sidecar is unavailable.

Acceptance:

- Forced indexer crash never blanks or exits the app shell.
- Indexer restarts and restores the catalog without a full rebuild.

#### Phase 5 Resource And Protocol Slice Result

Implemented on 2026-07-17:

- The build uses esbuild to produce one 9.5 MiB CommonJS Worker containing
  ArkLine semantic code, TypeScript, and JavaScript dependencies. That artifact
  is the deterministic input to the standalone sidecar builder and remains the
  direct Node entry for development; final release packages do not ship this
  CJS artifact as a duplicate resource.
- The generated artifact is ignored by Git and rebuilt by `pnpm build`. A real
  stdio health smoke runs after every Worker bundle, so a syntactically present
  but unstartable resource fails the build.
- Host and Worker now require semantic protocol version 3. Health advertises
  capabilities, and a missing or mismatched protocol fails explicitly before
  completion/navigation requests can be served.
- Dependency locking now declares esbuild directly at the already-pinned
  0.21.5 version. The lockfile contains no incidental package upgrades.
- Added a target-triple sidecar builder using the Tauri-documented
  `@yao-pkg/pkg` approach. It maps Windows x64/arm64, macOS x64/arm64, and Linux
  x64/arm64 explicitly and rejects unsupported targets rather than producing a
  mislabeled binary. Node 24 is intentional: `pkg-fetch` v3.6 publishes Node 24
  base assets for every supported target, while Node 20 returned 404 and fell
  back to compiling Node/OpenSSL from source. Release builds must never accept
  that unbounded fallback.
- A native x86_64 macOS standalone binary was built from the cached prebuilt
  base and passed protocol-v3 stdio health without a system Node process. Native
  target builds run this smoke automatically; cross-built artifacts require a
  native target CI job before release.
- The Rust launcher now models JavaScript+Node and standalone executable modes
  separately. A configured standalone Worker starts directly and does not fail
  because Node is absent or misconfigured.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Bundled Worker stdio health and protocol v3 | passed |
| Semantic Worker tests | 46 passed / 0 failed |
| Semantic Host targeted tests | 29 passed / 0 failed |
| Full Rust library tests | 741 passed / 11 ignored / 0 failed |
| Tauri resource configuration test | passed |
| Sidecar target mapping tests | 3 passed / 0 failed |
| Native standalone sidecar build and protocol-v3 smoke | passed |
| TypeScript and production Vite build | passed |
| Source files over 500 lines | none (708 checked) |

#### Phase 5 ExternalBin And Recovery Slice Result

Implemented on 2026-07-17:

- Production now launches `arkline-semantic` through the official Tauri Shell
  `sidecar()` API. The host never guesses an NSIS installation directory. Debug
  builds and explicitly configured Worker paths retain the direct Node or
  standalone process launcher.
- The session owns a transport interface instead of concrete `Child`, stdin,
  and stdout types. Direct processes and Tauri sidecars share one request-line
  contract. A transport lock covers write plus matching response, preventing
  concurrent callers from consuming each other's response IDs.
- Standalone readiness no longer fails at Provider construction because a Node
  path is absent. Worker startup is lazy and occurs only on the first semantic
  request, not during app-shell setup.
- A failed read-only semantic request invalidates the failed session, launches a
  fresh process, repeats the protocol-v3 health handshake, and retries once.
  A crash-on-first-request fixture verifies a new PID serves the retry.
- `LanguageRuntime` now clones an immutable router snapshot and releases its
  state lock before any provider call. A slow semantic request therefore cannot
  block fallback hover, settings inspection, or unrelated language commands.
- NSIS bundles the target-suffixed external binary. Portable Windows output is
  now `ArkLine-windows-x64.zip`, containing adjacent `ArkLine.exe` and
  `arkline-semantic.exe`; publishing a lone EXE is no longer supported.
- Rust unit tests override only `bundle.externalBin` through `TAURI_CONFIG`, so
  a clean checkout can test without generating a 70-90 MiB binary. Release
  packaging still fails when the real sidecar is absent.

Additional verification evidence:

| Gate | Result |
| --- | ---: |
| Tauri externalBin/package script tests | 19 passed / 0 failed |
| Worker crash, new PID, request retry | passed |
| Slow semantic request router-lock isolation | passed |
| Windows x64 sidecar cross-build | PE32+ x86-64 generated |
| Semantic Worker tests | 46 passed / 0 failed |
| Full Rust tests after recovery additions | 743 passed / 11 ignored / 0 failed |
| TypeScript and production Vite build | passed |
| Source files over 500 lines | none (713 checked) |

#### Phase 5 Supervisor And Resource Slice Result

Implemented on 2026-07-17:

- Every Worker response carries RSS, heap used, heap total, external memory, and
  process uptime. The Host records the response time as a heartbeat instead of
  starting a second competing request stream.
- Supervisor state is explicit: `idle`, `starting`, `running`, `degraded`,
  `restarting`, `backoff`, and `recycling`. Its snapshot includes restart count,
  consecutive failures, last heartbeat, retry delay, last error, memory values,
  and configured budget.
- A failed request gets one immediate restart and retry. If the retry also
  fails, the Supervisor enters exponential backoff from 250 ms up to 30 s.
  Requests during backoff fail immediately to the existing fallback provider;
  they do not launch another process or hold the UI.
- The default semantic RSS budget is 1024 MiB. Operators can set
  `ARKLINE_SEMANTIC_MEMORY_LIMIT_MB`; values are clamped to 256-8192 MiB. A
  response over budget is delivered, then the Worker is recycled, preserving
  the current completion/navigation result while bounding future residency.
- `inspect_language_service` exposes the snapshot as structured camel-case
  data. Index Diagnostics now has a Semantic Host section for state, restarts,
  failures, backoff, RSS, heap, budget, uptime, heartbeat, and last error.
- Startup over-budget, crash-once recovery, repeated crash backoff, protocol
  runtime parsing, memory recycling, and slow-request lock isolation all have
  direct regression coverage.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Semantic Host and Supervisor targeted tests | 35 passed / 0 failed |
| Semantic Diagnostics frontend tests | 11 passed / 0 failed |
| Semantic Worker tests | 46 passed / 0 failed |
| Full Rust tests | 748 passed / 11 ignored / 0 failed |
| TypeScript and production Vite build | passed |

#### Phase 5 Durable Recovery And Idle Watchdog Slice Result

Implemented on 2026-07-17:

- Document generation ownership now belongs to `SemanticHostManager`, not an
  individual process session. A crash and replacement process therefore cannot
  reset an unsaved editor buffer from generation N to generation 1.
- Protocol v3 adds bounded `restoreDocuments`. The Host retains at most 32 hot
  documents, 4 MiB total, and 1 MiB per document for replay. Generation
  identities remain separately bounded to 512 paths. This avoids turning crash
  recovery into an unbounded in-memory workspace mirror.
- A replacement Worker completes health negotiation and restores hot documents
  before a failed foreground request is retried. The Worker rejects stale,
  conflicting, oversized, and non-positive-generation replay input.
- Supervisor snapshots expose `restoredDocumentCount`. Index Diagnostics shows
  that value beside restart and memory evidence, making recovery verifiable
  without reading process logs.
- A 30-second idle watchdog detects an otherwise silent failed Worker. It uses
  `try_lock`; if completion, navigation, or another foreground request owns the
  transport, the probe is discarded immediately rather than queued. The
  watchdog holds only a weak Manager reference and cannot extend Provider
  lifetime.
- Idle failure invalidates the process and enters bounded backoff. It does not
  restart in a loop; the next foreground request may restart after backoff and
  continues to use the existing fallback provider while unavailable.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Worker replay, conflict, and bound tests | passed |
| Crash, hot-document replay, same-generation retry | passed |
| Foreground-busy watchdog skip | passed |
| Semantic Host targeted tests | 41 passed / 0 failed |
| Semantic Worker tests | 48 passed / 0 failed |
| Semantic Diagnostics frontend tests | 8 passed / 0 failed |
| Full Rust tests | 754 passed / 11 ignored / 0 failed |
| Production TypeScript and Vite build | passed |
| Source files over 500 lines | none |

Phase 5 remains active. Semantic analysis is isolated and now recoverable, but
workspace discovery, parsing, and SQLite writes still run in the desktop host.
Soft recycling is not an OS hard memory limit. The next architectural slice is
moving indexing behind the same process boundary with a durable queue/catalog
contract; hard limits then belong to the platform launcher rather than request
handlers.

#### Phase 5 Indexer Discovery Process Slice Result

Implemented on 2026-07-17:

- Added a standalone Rust `arkline-indexer` process with protocol-v1 JSON-lines
  health negotiation. Capabilities are advertised explicitly; this slice
  accepts only durable `discoveryChunk` work and cannot accidentally receive
  parse, semantic, or arbitrary SQLite commands.
- The Host owns scheduling intent, cancellation, diagnostics, and query reads.
  The sidecar owns the discovery transaction and durable cursor update. Task
  identity includes canonical root, task kind, generation, and reason.
- Discovery replay is monotonic and idempotent. An older cursor cannot move a
  generation backward, stale generations are rejected, and a new generation
  must begin without a cursor. Final publication removes files left behind by
  the previous generation.
- A process-restart integration test commits the first chunk, exits the
  sidecar, starts a new process, resumes from the SQLite cursor, and reaches
  `ready` without restarting discovery from the root.
- The production route is deliberately opt-in with
  `ARKLINE_INDEXER_ENABLED=1`. Missing executables, protocol errors, and process
  failures immediately use the existing local discovery executor. The status,
  process ID, completed chunks, fallback count, and last error are visible in
  Index Diagnostics.
- Windows installer and portable packaging now build the target-specific Rust
  sidecar. The portable archive keeps `ArkLine.exe`, `arkline-semantic.exe`, and
  `arkline-indexer.exe` adjacent. Native sidecar builds run protocol health
  smoke automatically.

This slice proves the process contract and durable restart boundary; it does
not complete Phase 5. Parsing, task-journal transitions, the single SQLite
writer actor, SDK artifact construction, compaction, sidecar supervision, and
hard OS memory limits remain in the next slices. The route must stay opt-in
until packaged Windows equivalence, cancellation-before-commit, crash-loop, and
large-workspace latency gates pass.

The final serial gate exposed and fixed two scheduler contract violations before
this slice was accepted. Discovery continuations were being assigned a new
generation, which would split one durable scan across incompatible generations.
They could also be superseded by an unrelated changed-path task because the
same-batch fast path ignored task reason. Continuations now retain their scan
generation, and changed-path tasks replace each other only when their reasons
match. Both rules have unit and end-to-end continuation coverage.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Native indexer release build and protocol-v1 smoke | passed |
| Real process health negotiation | passed |
| Process exit, SQLite cursor resume, and ready publication | passed |
| Missing sidecar local fallback | passed |
| Durable discovery replay/stale/prune tests | passed |
| Full Rust library tests | 765 passed / 11 ignored / 0 failed |
| Real indexer process integration tests | 2 passed / 0 failed |
| Semantic Worker tests | 48 passed / 0 failed |
| Packaging and Index Diagnostics frontend tests | 29 passed / 0 failed |
| TypeScript and production Vite build | passed |
| Source files over 500 lines | none (727 checked) |
| Local 5k synthetic search-input p95 | 0.615 ms |
| Local 5k synthetic file-switch p95 | 0.009 ms |

The two synthetic latency gates protect application scheduling code only. They
are not packaged Windows UI evidence and do not close Phase 6. Build and latency
tests must run serially because compilation contention already produced a false
p95 regression earlier in this phase.

#### Phase 5 Atomic Discovery Commit Slice Result

Implemented on 2026-07-17:

- The indexer stdio loop is the discovery writer actor: requests are processed
  serially, while SQLite `BEGIN IMMEDIATE` provides the cross-process writer
  boundary during the staged period where Host fallback still exists.
- Directory enumeration and metadata reads happen before the write transaction.
  The transaction revalidates generation and cursor after acquiring the writer,
  so slow filesystem work neither holds SQLite nor commits stale observations.
- Discovered file rows, stale-file pruning, discovery cursor/state, task-journal
  status, and the unified task event now commit in one transaction. A successful
  RPC response therefore cannot describe a cursor or terminal status that is
  absent after Host or sidecar process loss.
- The normal Host journal path also writes task status and its unified event in
  one transaction. Sidecar-internal code uses the same connection-level
  primitive and does not recursively acquire a Host writer gate.
- Replaying a request after a lost response returns the durable cursor with zero
  new files and does not append a duplicate event. A forced journal-trigger
  failure proves that discovered files, cursor/state, and task status all roll
  back together.
- Discovery layer state remains `running` while a cursor exists, whereas the
  bounded task result is `partial`. Keeping these state domains separate avoids
  false health and readiness projections.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Journal failure atomic rollback | passed |
| Lost-response idempotent replay without duplicate event | passed |
| Process restart cursor and journal recovery | passed |
| Task journal and unified event regression tests | 7 passed / 0 failed |
| Full Rust library tests | 765 passed / 11 ignored / 0 failed |
| Real indexer process integration tests | 2 passed / 0 failed |
| Native release sidecar rebuild and protocol-v1 smoke | passed |

This is a single-writer actor only for migrated discovery work. Parse/stub
publication, content and symbol writes, SDK artifacts, compaction, cancellation
messages, process supervision, and hard resource limits remain outside the
indexer process. Phase 5 stays active until those capabilities move behind
independently negotiated protocol methods and packaged Windows gates.

#### Phase 5 Background Stub Process Slice Result

Implemented on 2026-07-17:

- Source reads and ArkTS stub parsing now finish before either the SQLite writer
  gate or write transaction is acquired. The immutable prepared delta contains
  the normalized refresh plan and parsed stubs. Publication keeps stub rows,
  symbol postings, semantic-layer states, dependency edges, resolved symbols,
  definitions, and references in one short transaction.
- Full structured persistence follows the same prepare-then-publish order. A
  concurrent regression test holds the SQLite writer and proves parsing still
  completes independently instead of entering the writer wait queue.
- Indexer protocol v2 advertises `stubRefreshChunk`. Requests carry no file
  contents or AST, accept at most 64 total paths, reject paths outside the
  workspace, and currently accept background priority only. Larger 128-file
  scheduler budgets are split into bounded RPC chunks.
- The sidecar uses its persistent named parse pool, reads the durable file
  catalog, and checks the indexed generation both before parsing and again
  inside `BEGIN IMMEDIATE`. An older generation cannot overwrite newer rows;
  equal-generation replay is idempotent across process restart.
- Only full-refresh deep-layer continuations use the new method. Foreground
  completion/navigation, visible-file work, ordinary changed files, content
  indexing, and removals remain on the Host path. Missing executables, protocol
  errors, or process failures retain the established local executor.
- The Host checks durable file-catalog readiness before RPC. A deep task that
  races ahead of its file layer takes the local compatibility path without
  being misreported as a sidecar crash. Sidecar errors remain visible after
  later success rather than losing the most recent failure evidence.
- The Host no longer holds its runtime mutex while launching, negotiating, or
  waiting up to 30 seconds for the process. Session ownership is checked out for
  the request and returned afterward; diagnostics snapshots remain nonblocking
  during a deliberately delayed process response.
- Stub RPC waits poll the scheduler cancellation token every 25 ms. Cancellation
  invalidates the session and kills the Worker instead of waiting for the
  30-second RPC deadline; the next request performs a fresh health negotiation.
  A cancelled task returns `superseded` through the deep continuation and cannot
  enter local fallback or publish a duplicate stale parse result.
- Unix sidecars run in a dedicated process group, so cancellation also terminates
  descendants that retain stdio handles. Windows currently terminates the direct
  sidecar process; Job Object ownership remains required before packaged Windows
  equivalence can claim process-tree and hard-resource enforcement.
- Index Diagnostics separates completed discovery, completed stub, and cancelled
  stub chunk counts and continues to expose process ID, fallback count, state,
  and last error. Cancellation is not counted as a sidecar failure.

Verification evidence:

| Gate | Result |
| --- | ---: |
| Parse while SQLite writer is held | passed |
| Protocol oversize and capability tests | passed |
| Real process parse-error, replay, restart, and stale-generation test | passed |
| Missing sidecar discovery and stub local fallback | passed |
| Slow sidecar diagnostics-lock isolation | passed (<100 ms snapshot gate) |
| Slow stub cancellation, process replacement, and no false fallback | passed (<500 ms cancellation gate) |
| Pre-cancelled deep task performs no content/stub write | passed |
| Full Rust suite | 774 passed / 11 ignored / 0 failed |
| Real indexer process integration | 3 passed / 0 failed |
| Semantic Worker suite | 48 passed / 0 failed |
| Diagnostics and packaging frontend tests | 20 passed / 0 failed |
| Production TypeScript and Vite build | passed |
| Native release indexer protocol-v2 smoke | passed |
| 1k open + background pipeline with sidecar | 3.39-4.73 s observed; 66.1 ms first tick; 0.895 ms Quick Open; 16 stub chunks; 0 fallback |
| 5k synthetic search-input p95 | 0.760 ms |
| 5k synthetic file-switch p95 | 0.011 ms |
| Source files over 500 lines | none |

Phase 5 remains active. The v2 stdio handler still executes one RPC at a time,
but Host cancellation now preempts an in-flight stub batch by terminating its
session; generation checks protect against an acknowledgement lost after commit.
Content-index publication, removals, ordinary changed-file parsing, SDK artifact
construction, compaction, crash-loop backoff, indexer heartbeat/resource
supervision, Windows Job Object ownership, and packaged Windows equivalence
remain the next process-isolation slices. The opt-in flag must remain off by
default until those release gates pass.

#### Phase 5 Background Content Process Slice Result

Implemented on 2026-07-17:

- Content source reads, UTF-8 decoding, and line materialization now run before
  the SQLite writer gate. Only the prepared immutable delta enters the writer,
  so a slow disk read cannot block search readers or unrelated publication.
- Content schema v3 adds `workspace_content_files` with generation, line count,
  status, error, and update time. Readiness no longer guesses from the presence
  of content rows: an empty file is `ready`, while an unreadable file is
  explicitly `failed` with a diagnostic reason.
- Indexer protocol v3 advertises `contentRefreshChunk`. It accepts at most 64
  paths, rejects duplicates and lexical workspace escapes, requires background
  priority, and carries no source content across the RPC boundary.
- The Worker checks generation before preparation and again after acquiring
  `BEGIN IMMEDIATE`. Ordinary rows, FTS5 rows, trigram rows, and per-file state
  publish in one transaction. Equal-generation replay is idempotent after
  process restart; an older generation cannot overwrite newer evidence.
- A background deep continuation sends content chunks before stub chunks. If
  content succeeds but stub RPC becomes unavailable, Host fallback publishes
  only the stub layer and does not reread or republish content. A completely
  unavailable sidecar records one fallback, not one per layer.
- Content RPC cancellation polls the scheduler token every 25 ms, terminates the
  session/process group, records a cancellation separately from failure, and
  cannot enter local fallback. Index Diagnostics exposes completed and cancelled
  content chunk counters independently from discovery and stub counters.
- The sidecar route is still opt-in. Removed paths, foreground/visible-file
  refresh, ordinary changed-file work outside deep continuations, and SDK work
  remain on the compatibility path.

Targeted verification evidence:

| Gate | Result |
| --- | ---: |
| Content prepare while SQLite writer is held | passed |
| Protocol path bound, duplicate, and workspace-escape rejection | 3 passed / 0 failed |
| Atomic ordinary/FTS/trigram publish, replay, stale generation, unreadable source | 3 passed / 0 failed |
| Empty-file and failed-file readiness projection | 3 passed / 0 failed |
| Missing-sidecar one-shot content plus stub fallback | passed |
| Slow content cancellation and no false fallback | passed (<500 ms cancellation gate) |
| Real process content replay, restart, and stale-generation rejection | passed |
| Real indexer process integration | 4 passed / 0 failed |
| Diagnostics and package-script frontend tests | 9 passed / 0 failed |
| Full Rust suite, run serially | 785 passed / 11 ignored / 0 failed |
| Semantic Worker suite | 48 passed / 0 failed |
| TypeScript and production Vite build | passed |
| Native release indexer protocol-v3 smoke | passed |
| 1k open + content/stub background pipeline | 8.59 s total; 80.2 ms first tick; 1.11 ms Quick Open; 16 content + 16 stub chunks; 0 fallback |
| Source line-count gate | 738 files checked; none over 500 lines |

Phase 5 remains active. Path count is bounded but total source bytes are not yet
hard-bounded, and stdio still serializes content and stub RPCs in one Worker.
The 1k measurement is materially slower than the earlier stub-only 3.39-4.73 s
range, even though foreground Quick Open remains fast. This confirms that the
single serial Worker is now a background-throughput bottleneck; it must be
addressed with bounded internal lanes or separate process capabilities, not by
moving work back onto the Host/UI path.
The next isolation slice must add per-file and per-chunk byte budgets before the
process route is enabled by default, then migrate removal deltas and ordinary
changed-file work. SDK artifact construction, compaction, crash-loop backoff,
heartbeat/resource supervision, Windows Job Object ownership, and packaged
Windows performance/equivalence gates remain open.

#### Phase 5 Bounded Incremental Delta And Dual-Lane Result

Implemented on 2026-07-17:

- Protocol v4 adds the `contentResourceBudget` capability. Content preparation
  enforces a 4 MiB per-file limit and a 32 MiB per-chunk source budget before
  allocating the complete source. The prepared delta owns one UTF-8 buffer per
  file and derives lines by borrowing slices during publication; it no longer
  retains a second full vector of copied lines.
- Host chunk planning uses file metadata to bound both total path count and
  expected source bytes. Oversized, unreadable, and non-UTF-8 files publish an
  explicit failed readiness record with a diagnostic reason instead of silently
  disappearing or exhausting Worker memory.
- Ordinary watcher deltas no longer trigger a root rescan. The Worker applies
  directly reported additions, modifications, and removals, expands the durable
  reverse-dependency closure with a 500-file cap, and uses the full correctness
  path only when that cap is exceeded.
- Removal-only and mixed changed/removal batches now use the sidecar for both
  content and stub layers. A regression fixture proves that an unrelated,
  unreported new file is not discovered by the ordinary watcher path.
- Content schema domain 4 and stub schema domain 2 share a root-level layer
  generation watermark. Deleting the last per-file row therefore cannot erase
  stale-write evidence and allow an older replay to resurrect removed content
  or symbols. Each transaction checks the watermark before publication and
  advances it atomically with the layer delta.
- The Host owns three bounded process lanes: discovery, content, and stub.
  Content and stub preparation may overlap in independent sidecars, while the
  existing SQLite writer gate remains the only publication lane. Cancellation
  kills only the affected process lane; diagnostics expose all three PIDs and
  keep completion, cancellation, fallback, and last-error counters distinct.
- Parallel deep refresh is enabled only when the configured sidecar executable
  exists. A missing or disabled sidecar retains the one-shot local compatibility
  path rather than launching two guaranteed failures.

Measured debug-profile evidence on the same 1,000-file fixture:

| Workload | Serial v4 | Bounded dual lane |
| --- | ---: | ---: |
| Open + background pipeline | 10.63 s | 9.72 s |
| First worker tick | 72.3 ms | 266.5 ms |
| Quick Open after drain | 0.98 ms | 0.86 ms |
| Content / stub chunks | 16 / 16 | 16 / 16 |
| Sidecar fallback | 0 | 0 |

The total improvement is about 8.6%, so process-channel serialization was real
but not the dominant remaining cost. The slower first tick is a noisy debug
measurement and blocks any release claim until repeated p50/p95/p99 evidence is
available. The next throughput slice must profile the single-writer critical
section by stage, then shorten or defer dependency resolution, definition, and
reference derivation. Adding more process lanes is not justified by this result.

#### Phase 5 Single-Writer Self-Lock Diagnosis Result

Implemented and measured on 2026-07-17. The writer critical section was split
into metadata, file catalog, symbol persistence, stub deletion, stub parsing,
stub publication, dependency graph, symbol resolution, and reference refresh
stages. The first 128-file chunk showed that dependency and definition work was
not the bottleneck: dependency graph refresh took 5.25 ms and symbol resolution
took 7.62 ms, while reference refresh took 5.45 s.

The detailed reference profile isolated 5.41 s in
`WorkspaceMemberReferenceContext::load`. That method was running inside the
workspace write transaction but opened a second connection to the same
workspace SQLite database while resolving the active shared SDK binding. Schema
initialization on the second connection waited for SQLite's configured five
second busy timeout. The error was then treated as an optional shared-SDK miss,
so the local fallback succeeded and concealed the self-lock from correctness
tests.

A deterministic regression now acquires the workspace writer lock before
loading the member context and requires completion within 500 ms. It failed in
10.81 s before the fix and passes in 0.05 s after the fix. Shared SDK member
lookup now reads the workspace binding through the caller's current connection
and opens only the separate shared SDK artifact database.

Measured debug-profile evidence after the fix:

| Workload | Before | After |
| --- | ---: | ---: |
| First-chunk member context load | 5.410 s | 0.90 ms |
| First-chunk reference refresh | 5.454 s | 42.36 ms |
| Three-chunk persistence profile | 12.87 s | 1.88 s |
| 1k open + background sidecar pipeline | 9.72 s | 6.96 s |
| First usable worker tick | 266.5 ms | 65.0 ms |
| Quick Open after drain | 0.86 ms | 0.88 ms |

This evidence changes the next architectural action. Stub, dependency,
definition, and reference publication remain one generation-checked atomic
transaction for now. Splitting derived layers would add intermediate readiness,
replay, and cross-generation consistency states without addressing the measured
cause. A derived-layer split becomes justified only when repeated release-build
p95/p99 profiles show that an individual writer hold still exceeds its budget
after self-locks and accidental nested workspace connections are eliminated.
New connection-level APIs used inside writer transactions must accept the
existing connection explicitly; they must not reopen the workspace store by
root path.

#### Phase 5 Writer Contention Observability Result

Implemented and measured on 2026-07-17. The original connection manager exposed
one mutex per workspace, but that mutex was process-local. Discovery, content,
and stub refresh currently run in three independent sidecars, so a Host snapshot
could not distinguish process queueing, SQLite transaction acquisition, and
actual publication work. The old `hold` percentile combined all three and made
long transactions look like parser or persistence cost without evidence.

Protocol v4 now carries optional per-lane writer telemetry. The Host retains the
latest discovery, content, and stub samples; the diagnostics center reports the
worst lane rather than calculating an invalid percentile across already
aggregated distributions. Old v4 sidecars remain compatible because telemetry
is additive and is not a required capability.

An OS advisory-lock experiment was implemented and tested before adoption. It
did serialize arbitrary operation closures across independent connection
managers, but it duplicated SQLite's write-transaction arbitration and widened
the serialized region beyond publication. The experiment was therefore removed:

| 1k debug profile | Total | Content wait p95 | Content hold p95 | Stub wait p95 | Stub hold p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| File-lease stable sample | 26.18 s | 812 ms | 2.10 s | 2.07 s | 868 ms |
| File-lease noisy sample | 131.54 s | 3.50 s | 11.80 s | 9.91 s | 3.61 s |

This is a rejected design result, not a release benchmark. A persistent empty
lock file was not the issue; the architectural error was adding a second writer
scheduler around every short SQLite transaction without batching or owning the
complete publication pipeline.

The retained implementation introduces one transaction-boundary API for
discovery, content, stub, and task-journal publication. It performs schema/setup
work, measures the `BEGIN IMMEDIATE` acquisition separately, commits only after
the supplied publication closure succeeds, and rolls back on error. Metrics now
mean:

- `wait`: process-local gate wait plus SQLite immediate-transaction acquisition;
- `hold`: connection/setup work plus transaction publication and commit;
- `failure`: setup, acquisition, publication, or commit failure;
- `active` and `queued`: current process state, never a fabricated global count.

Measured 1,000-file debug evidence with three real sidecar processes:

| Measure | Result |
| --- | ---: |
| Open plus full background pipeline | 9.68 s |
| First worker tick | 64.2 ms |
| Quick Open after drain | 0.90 ms |
| Content transaction wait p95 / max | 10 us / 10 us |
| Stub transaction wait p95 / max | 14 us / 14 us |
| Content publication hold p95 / max | 810 ms / 810 ms |
| Stub publication hold p95 / max | 1.16 s / 1.16 s |
| Fallbacks / restarts / cancellations | 0 / 0 / 0 |

A 100-file diagnostic run completed in 2.20 s. Six connection tests prove WAL
reader coexistence, same-process serialization, real transaction serialization
across independent managers, bounded reader reuse, and failure cleanup. Content,
discovery, task-journal, protocol, and real-sidecar suites preserve generation,
idempotency, deletion, and rollback behavior.

The measurements show that cross-process SQLite acquisition is currently
microsecond-scale; publication work, not lock waiting, is the next bottleneck.
The next writer slice should profile and shorten content and stub publication,
use adaptive chunk budgets, and batch terminal journal updates. A dedicated
writer actor remains the final architecture because it enables fair scheduling,
group commit, one connection lifecycle, and global queue observability. It must
replace the three publication lanes only after equivalence and crash-replay
tests; an advisory file lock is not an acceptable substitute.

These are local debug samples, not packaged Windows release evidence. Phase 6
still requires repeated p50/p95/p99 runs on an exclusive machine. A repeated
transaction-wait p95 above 50 ms or publication-hold p95 above 250 ms is the
trigger for prioritizing writer batching/actor migration over adding parser
threads.

Final gates for this writer-observability slice:

| Gate | Result |
| --- | ---: |
| Serial Rust library suite | 796 passed / 11 ignored / 0 failed |
| Real sidecar integration | 4 passed / 0 failed |
| Index diagnostics UI | 8 passed / 0 failed |
| Product runtime search input p95 | 0.848 ms |
| Product runtime file switch p95 | 0.166 ms |
| Production TypeScript/Vite build | passed |
| Source line-count gate | 743 files checked; none over 500 lines |
| Whitespace gate | passed |

#### Phase 5 Indexer Crash-Loop Backoff Result

Implemented on 2026-07-17:

- Discovery, content, and stub process lanes keep independent failure and
  restart state. A crashing stub lane therefore does not suppress discovery or
  content work.
- The first terminal failure applies a 250 ms restart delay. Consecutive
  failures use exponential backoff capped at 30 s. Requests received during the
  delay return immediately to the existing local fallback path and do not spawn
  or wait for another process.
- A successful request clears that lane's consecutive failure state. Cooperative
  cancellation terminates the affected process but is recorded as cancellation,
  not a crash, and does not enter backoff.
- The diagnostics contract reports aggregate restart count, maximum consecutive
  lane failures, remaining backoff, fallback count, lane PIDs, and the last
  error. The visible status is derived from all lanes at snapshot time, so one
  lane cannot incorrectly overwrite another lane's `backoff` state with `idle`,
  and expired delays do not remain displayed as active.
- A real-process regression uses a sidecar that exits during health negotiation.
  Two immediate requests produce one process launch, the second request returns
  without waiting, and exactly one restart is allowed after the delay expires.

This is restart-storm containment, not yet complete resource supervision. Hard
memory/CPU enforcement, process-tree ownership on Windows, periodic indexer
heartbeats, and packaged release soak evidence remain open. The backoff policy
keeps those later controls from turning repeated failures into UI-visible
process churn while preserving functional local fallback.

Targeted gates passed for protocol negotiation, hard path/byte bounds, direct
watcher deltas, stale generation after last-row deletion, independent process
lanes, missing-sidecar fallback, cancellation, and the real sidecar process.
The route remains opt-in because Windows Job Objects, crash-loop supervision,
hard process memory/CPU limits, packaged Windows equivalence, and release-profile
soak gates are still open.

Final verification for this slice:

| Gate | Result |
| --- | ---: |
| Serial Rust library suite | 790 passed / 11 ignored / 0 failed |
| Real sidecar integration | 4 passed / 0 failed |
| Semantic Worker suite | 48 passed / 0 failed |
| Index diagnostics UI suite | 8 passed / 0 failed |
| Protocol/package script test | passed |
| TypeScript and production Vite build | passed |
| Source line-count gate | 742 files checked; none over 500 lines |
| Whitespace gate | passed |

The repository-wide frontend suite is not currently a usable release gate: it
contains pre-existing bottom-panel and hotkey timeouts, stale Build UI labels,
old Tauri `undefined` argument expectations, document/search-reader assertion
drift, and unresolved React `act()` work that can leave the `app-shell` suite
running without progress. The focused diagnostics suite and production build
pass. These unrelated failures must be repaired as a separate test-infrastructure
slice before Phase 6 can claim a green repository-wide frontend gate.

### Phase 6: Release Performance And Reliability Gate

- [ ] Add 1k, 20k, and 100k fixture profiles.
- [x] Add headless product-runtime rapid type/delete, search close, file-switch,
  and jump soak tests.
- [x] Record headless p50/p95/p99, pending loads, candidate count, render commits,
  heap delta, cancellation, and stale-result rejection.
- [ ] Record packaged queue wait, SQLite lock wait, allocation count, process
  memory, WebView render commits, and Worker restarts.
- [ ] Run gates on packaged Windows builds before release.
- [ ] Run latency gates on an exclusive CI runner in a serial stage; concurrent
  compilation and bundling must not contaminate p95/p99 evidence.

Acceptance:

- No editor crash or app white screen in a 30-minute mixed-workload soak.
- No unbounded queue, WAL growth, memory growth, or stale result application.
- All strict performance gates pass on the documented release machine class.

#### Phase 6 Headless Mixed Interaction Soak Result

Implemented on 2026-07-17. The previous runtime scripts measured a separate
array string scan and `split`/`slice` projection; they did not execute ArkLine
product code and could not support an IDE responsiveness claim. The existing
commands now run a Vitest soak that imports the production search input and
generation runtime, search session store, document load coordinator, persistent
CodeMirror text store, chunked text builder, and navigation transaction runtime.

The search scenario alternates Search Everywhere and content-search sessions,
types and deletes 100 drafts, closes half before debounce, commits the others,
and resolves a closed query after invalidation. The navigation scenario switches
50 files and resolves 50 jump targets in reverse order. The cache remains capped
at 16, pending loads return to zero, 49 stale jumps are rejected, and only the
latest target is published.

Local headless evidence:

| Scenario | p50 | p95 | p99 | Correctness evidence |
| --- | ---: | ---: | ---: | --- |
| Search type/delete/close | 0.317 ms | 0.696 ms | 1.022 ms | 0 stale applies; 110 render commits |
| File switch | 0.083 ms | 0.172 ms | 1.532 ms | 0 pending loads; cache 16 |
| Jump dispatch | - | 0.010 ms | - | 49 stale rejected; 1 latest applied |

This is deliberately not marked as release or packaged evidence. jsdom cannot
measure native WebView paint, Tauri IPC contention, SQLite writer lock wait,
sidecar RSS, or app white-screen recovery. The next Phase 6 slice must run a
mixed workload through a built application, and the release claim still requires
a 30-minute packaged Windows soak on an exclusive runner.

## Explicit Non-Solutions

- Raising the memory limit without eliminating full scans and cloning.
- Increasing parser thread count without reserved foreground capacity.
- Debouncing alone while each accepted query still performs a full scan.
- Rebuilding all indexes on project open or after ordinary file edits.
- Hiding index progress or reporting `Ready` before required generations publish.
- Treating debug-profile microbenchmarks as packaged-app release evidence.
