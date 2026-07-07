# ArkLine Performance Profiles And Runtime Budgets Design

## Goal

Give ArkLine a mature performance configuration model that improves large-project responsiveness without pretending that a single "max runtime memory" setting can solve CPU, IO, query, and UI contention.

The design adds performance profiles, memory/cache budgets, parser worker budgets, indexing backpressure, and diagnostics. It must support phased implementation and fit the existing index roadmap: discovery first, foreground files first, background indexing later, observable readiness always.

## Product Position

ArkLine should expose performance controls like a professional IDE, not like a low-level VM launcher. Users should normally choose a profile:

- `Balanced`
- `Large Project`
- `Low Memory`
- `Custom`

Advanced numeric controls live behind `Custom`. The default must be safe for laptops, while `Large Project` favors responsiveness and cache reuse on medium/large repositories.

## Why Max Runtime Memory Alone Is Not Enough

Rust/Tauri does not have one JVM-style heap knob such as `-Xmx`. ArkLine memory pressure comes from several independent owners:

- Rust index state, queues, file lists, parsed stubs, symbol vectors, and hot caches.
- SQLite page cache and write transactions.
- WebView/JavaScript heap, editor buffers, search results, and rendered DOM rows.
- OS file cache and process scheduling.

Therefore the useful controls are **budgets ArkLine owns**:

- parser worker count;
- background indexing CPU aggressiveness;
- parse queue length;
- writer batch size;
- content/search cache size;
- symbol/stub hot cache size;
- opened document cache size;
- maximum result rows kept in memory;
- large-project lazy loading thresholds.

The UI may show an approximate `Runtime memory budget`, but internally it must map to these budgets instead of claiming hard process memory enforcement.

## User Experience

Settings should add a `Performance` section:

```text
Performance
  Profile
    Balanced
    Large Project
    Low Memory
    Custom

  Indexing
    Parser workers: Auto / 1 / 2 / 4 / 6 / 8
    Background indexing: Conservative / Balanced / Aggressive
    Foreground task reserve: On

  Memory Budgets
    Index hot cache
    Search result cache
    Opened document cache
    Max retained diagnostics/events

  Large Project
    Lazy project tree loading
    Use persisted index on reopen
    Auto switch to Large Project profile
```

Status bar should show only a compact summary:

```text
Perf: Balanced
Index: Parsing 3/4
Cache: 420 MB
```

Clicking the status opens diagnostics with the full budget and pressure details.

## Profile Defaults

### Balanced

Target: normal projects and most laptops.

- parser workers: `min(cpu_count - 1, 4)`, minimum 1;
- foreground reserve: enabled;
- writer batch size: 128 files;
- index hot cache: 512 MB target;
- search result cache: 128 MB target;
- opened document cache: 128 MB target;
- background indexing yields frequently;
- global search result retention capped.

### Large Project

Target: medium/large workspaces where search and navigation must stay responsive while indexing continues.

- parser workers: `min(cpu_count - 1, 6)`, minimum 2;
- foreground reserve: enabled;
- writer batch size: 256 files, with transaction time budget;
- index hot cache: 1024 MB target;
- search result cache: 256 MB target;
- opened document cache: 256 MB target;
- project tree lazy loading required;
- persisted index reuse enabled;
- stale cached results may be shown with readiness labels;
- background indexing uses larger chunks but must yield between chunks.

### Low Memory

Target: small-memory machines or battery-sensitive use.

- parser workers: `min(cpu_count - 1, 2)`, minimum 1;
- foreground reserve: enabled;
- writer batch size: 64 files;
- index hot cache: 128 MB target;
- search result cache: 64 MB target;
- opened document cache: 64 MB target;
- aggressive cache eviction;
- background indexing conservative.

### Custom

Target: advanced users and profiling.

Custom allows explicit values but keeps guardrails:

- parser workers cannot exceed 8 without a hidden developer flag;
- foreground reserve cannot be disabled unless parser workers is 1;
- writer batch size has both file-count and time-budget limits;
- cache budgets below minimums trigger a warning that features may degrade.

## Configuration Model

Add a durable user/workspace settings model:

```json
{
  "performance": {
    "profile": "balanced",
    "parserWorkers": "auto",
    "backgroundIndexing": "balanced",
    "foregroundTaskReserve": true,
    "indexHotCacheMb": 512,
    "searchResultCacheMb": 128,
    "openedDocumentCacheMb": 128,
    "writerBatchFiles": 128,
    "writerBatchMs": 150,
    "autoLargeProjectMode": true
  }
}
```

Persistence should support:

- global settings;
- workspace override;
- future CLI override;
- effective settings query for diagnostics.

The backend should expose only the effective runtime config to core services. UI settings are allowed to store user intent, but indexing services should consume normalized values.

## Runtime Architecture

```text
Settings
  |
  v
Performance Config Service
  |
  +-- Effective Runtime Budgets
  |     parser_workers
  |     foreground_reserve
  |     writer_batch_files
  |     writer_batch_ms
  |     cache_budgets
  |
  +-- Diagnostics Snapshot
        active_profile
        estimated_cache_mb
        parse_queue_depth
        active_workers
        writer_backlog
        evictions
```

Consumers:

- `workspace_index_parse_pool_service` reads parser worker budget.
- index scheduler reads foreground reserve and background aggressiveness.
- writer service reads batch file/time budgets.
- search/query services read result-cache and max-result budgets.
- diagnostics/status services expose effective config and pressure.

## Indexing Semantics

Performance settings must never break correctness:

- foreground navigation/completion still outrank background work;
- stale generations cannot publish over newer generations;
- cache eviction cannot delete durable SQLite facts;
- low-memory mode may reduce result retention, but query readiness must explain partial results;
- writer batch size affects throughput only, not transaction correctness;
- changing profile at runtime affects newly scheduled work and cache budgets, not already committed facts.

## Memory Budget Semantics

Budgets are soft targets:

- caches evict toward target;
- queues apply backpressure when over budget;
- diagnostics reports estimated usage;
- ArkLine may exceed the target briefly during foreground work;
- no UI should call this a hard OS memory limit.

The design should avoid exact process-memory promises until ArkLine has reliable cross-platform memory telemetry.

## Large Project Auto Mode

ArkLine should suggest or auto-apply `Large Project` when any of these are true:

- discovered files exceed 20,000;
- source files exceed 5,000;
- index DB exceeds 512 MB;
- background indexing is still active after 60 seconds;
- parse queue backlog exceeds a threshold for repeated intervals.

The first implementation should only show a recommendation. Automatic switching can come after diagnostics are trustworthy.

## Observability

Diagnostics must show:

- active profile;
- effective parser worker count;
- active parser workers;
- parse queue depth by priority;
- writer backlog and current batch duration;
- cache budget and estimated usage;
- eviction counts;
- slowest parsed files;
- foreground task wait time;
- background task yield count;
- last profile change and source: global/workspace/auto.

Status labels should stay concise:

- `Perf: Balanced`
- `Perf: Large Project`
- `Index: Parsing 2/6`
- `Cache: pressure high`

## Failure And Degraded Modes

If profile configuration is invalid:

- fall back to `Balanced`;
- record a diagnostics warning;
- do not block project open.

If memory pressure is high:

- evict search results first;
- evict unopened document cache second;
- reduce background parser concurrency temporarily;
- keep current editor file and foreground query facts hot;
- show `Cache: pressure high` only when the pressure persists.

If parser workers are exhausted:

- keep one worker effectively reserved for foreground tasks when worker count is greater than 1;
- background queues must yield rather than starving foreground tasks.

## Phased Implementation Plan

### Phase 1: Effective Config Service

Create backend types for:

- performance profile;
- user setting values;
- normalized effective runtime budgets;
- validation warnings.

Add tests for:

- profile defaults;
- auto parser worker calculation;
- custom clamping;
- invalid setting fallback.

### Phase 2: Parser Worker Budget

Connect effective `parser_workers` to `workspace_index_parse_pool_service`.

Add tests for:

- `Balanced` caps workers at 4;
- `Large Project` caps workers at 6;
- `Low Memory` caps workers at 2;
- `Custom` cannot exceed guardrails.

### Phase 3: Foreground Reserve And Backpressure

Add scheduler behavior so foreground parse/index work cannot be fully starved by background batches.

Add tests for:

- foreground navigation submitted during background parsing starts before remaining background jobs;
- background batches yield after budget;
- queue pressure appears in diagnostics.

### Phase 4: Cache Budget Model

Introduce explicit cache owners and soft limits:

- search result cache;
- opened document cache;
- index hot cache metadata.

Add tests for:

- LRU eviction;
- current editor file is protected;
- cache budget changes shrink caches without losing durable index facts.

### Phase 5: Settings UI

Add a restrained IDE-style Performance settings pane:

- profile selector;
- parser workers control;
- memory budget fields;
- large-project recommendation;
- effective config preview.

Settings should require Apply/Cancel and should not restart indexing automatically unless the user applies changes.

### Phase 6: Diagnostics Integration

Expose diagnostics through backend commands and status bar:

- active profile;
- workers;
- cache pressure;
- queue pressure;
- writer pressure.

Add frontend tests for:

- status summary rendering;
- settings effective preview;
- warning states.

### Phase 7: Adaptive Large Project Recommendation

Use discovery/index telemetry to recommend `Large Project`.

First release behavior:

- show recommendation only;
- user applies manually.

Later behavior:

- optional automatic switch per workspace.

## Non-Goals

- Do not implement a fake hard process memory limit.
- Do not add platform-specific OS memory enforcement in the first version.
- Do not make `Large Project` block project open while recalculating all indexes.
- Do not let UI settings bypass backend normalization.
- Do not keep unlimited search results or diagnostics events in memory.

## Acceptance Criteria

- Users can choose a performance profile and see the effective runtime budgets.
- Parser pool worker count comes from normalized config.
- Foreground indexing remains prioritized regardless of profile.
- Cache budgets are soft limits with visible diagnostics.
- Large project recommendation is based on measurable workspace/index pressure.
- Every implementation slice keeps Rust/TS files below 500 lines.
- Existing index correctness tests continue to pass.
