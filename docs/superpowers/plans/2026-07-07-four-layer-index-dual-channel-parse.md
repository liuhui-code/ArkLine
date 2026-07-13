# Four Layer Index And Dual Channel Parsing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor ArkLine indexing toward IDE-grade parsing strategy: hot project files become usable first, SDK APIs are parsed separately as API declarations only, and deep project indexing runs in interruptible background work.

**Architecture:** Keep SQLite as durable fact storage and keep existing scheduler/worker contracts. Add explicit layer and channel planning services so the worker can choose File Hot, Project File, Project Deep, and SDK API work deliberately instead of treating all parse work as one broad refresh. SDK indexing becomes an API-only, chunked, cache-aware channel that never blocks foreground file readiness.

**Tech Stack:** Rust/Tauri backend services, SQLite workspace index tables, existing `WorkspaceIndexScheduler`, `WorkspaceIndexRuntime`, ArkTS stub parser, SDK parser, Cargo tests, existing frontend readiness/facade contracts.

---

## Execution Progress

- [x] Task 1: Layer And Channel Strategy Model
- [x] Task 2: SDK API-Only Scan Plan
- [x] Task 3: SDK API Declaration Parser Contract
- [x] Task 4: SDK API Cache Key And Skip Path
- [x] Task 5: Chunked SDK API Indexing
- [x] Task 6: Four-Layer Readiness Projection
- [x] Task 7: Query Facade Evidence For Layered Results
- [x] Task 8: Performance And Regression Gates

Latest implementation notes:

- Task 5 now routes `IndexSdk` through the SDK API channel in chunks.
- SDK partial results carry `sdk_remaining_files`, `sdk_path`, and `sdk_version` so follow-up scheduling can continue SDK work without mixing it into project changed-path refreshes.
- Added worker/follow-up regression tests for SDK chunk progress and SDK continuation scheduling.
- Task 6 now adds IDE-facing aggregate readiness layers: `fileHot`, `projectFile`, `projectDeep`, and `sdkApi`, while preserving legacy diagnostic layers.
- Task 7 now appends `layer:projectFile:*` and `layer:sdkApi:*` evidence to Search Everywhere and completion explain output.
- Task 8 now protects foreground file readiness while SDK API indexing is queued, and extends the ignored real-project interaction profile with SDK first-progress and foreground-during-SDK timing.

## Current State

ArkLine already has useful building blocks:

- `WorkspaceIndexTaskPriority` separates foreground navigation/completion, visible files, full refresh, SDK indexing, and background.
- `WorkspaceIndexParsePool` runs ArkTS stub parsing in worker threads and orders jobs by priority.
- Full refresh and deep layer continuations already yield and resume in chunks.
- SDK indexing is an independent `IndexSdk` task.
- Search/query facades already expose readiness and partial state.

The missing part is strategy:

- `IndexSdk` calls `collect_sdk_symbols(sdk_path)` and recursively scans SDK files in one pass.
- SDK parsing has no API-only scan plan, no public/exported declaration filter, no chunk progress, and no cache skip.
- Project file indexing and SDK parsing are separate tasks but not separate channels with explicit scheduling policy.
- Deep layer work can still compete with foreground-visible file needs unless every call site manually chooses the right priority.
- Readiness does not clearly report File Hot, Project File, Project Deep, and SDK API layers.

## Target Architecture

### Four Index Layers

1. **File Hot Layer**
   - Current editor file, opened tabs, visible project tree file, recent navigation targets.
   - Provides file row, symbol outline, imports/exports, local declarations, and member stubs.
   - Must run before SDK and deep layer work.

2. **Project File Layer**
   - Project file list, path index, file names, class/interface/function outline, exports/imports.
   - Enables Double Shift files/classes/symbols early.

3. **Project Deep Layer**
   - References, receiver types, dependency graph, content index, usage search support.
   - Runs as background/continuation work and yields during UI activity.

4. **SDK API Layer**
   - API declaration surface only: `.d.ts`, declaration `.ts/.ets`, exported/public API signatures.
   - Excludes samples, tests, docs, build output, implementation internals, generated noise.
   - Cached by SDK path/version/parser version/scan manifest fingerprint.

### Dual Parsing Channels

- **Project Channel:** file hot, project file, and project deep layers.
- **SDK API Channel:** SDK declaration scan, API symbol parse, SDK persistence.

The scheduler still owns one queue, but work planning produces channel-aware tasks and priorities. The worker must be able to report which layer/channel is running, partial, ready, skipped, or failed.

## File Boundaries

- Create `src-tauri/src/services/workspace_index_layer_strategy_service.rs`
  - Defines stable layer/channel enums and priority mapping.
- Create `src-tauri/src/services/workspace_sdk_api_scan_plan_service.rs`
  - Selects SDK declaration files with explicit include/exclude rules and deterministic chunking.
- Create `src-tauri/src/services/workspace_sdk_api_cache_service.rs`
  - Computes SDK API cache keys and decides whether an SDK parse can be skipped.
- Modify `src-tauri/src/services/workspace_sdk_parser_service.rs`
  - Add API-only declaration filtering and exported/public visibility extraction.
- Modify `src-tauri/src/services/workspace_sdk_index_service.rs`
  - Replace one-shot recursive scan with scan-plan chunks and cache-aware persistence.
- Modify `src-tauri/src/services/workspace_index_worker_service.rs`
  - Run `IndexSdk` through SDK API channel with progress/partial results.
- Modify `src-tauri/src/services/workspace_index_scheduler_service.rs`
  - Keep existing priority enum, add tests proving SDK API does not outrank foreground/visible files.
- Modify `src-tauri/src/services/workspace_index_layer_readiness_service.rs`
  - Report four layer states explicitly.
- Modify `src-tauri/src/services/workspace_index_facade_search_service.rs`
  - Preserve merged query behavior and expose SDK layer readiness in explanations.
- Modify `src-tauri/src/lib.rs`
  - Register new service test modules.

Keep every new Rust source/test file under 500 lines. If an existing modified file approaches 500 lines, split helper code into a new service file instead of expanding it.

---

## Task 1: Layer And Channel Strategy Model

**Files:**
- Create: `src-tauri/src/services/workspace_index_layer_strategy_service.rs`
- Create: `src-tauri/src/services/workspace_index_layer_strategy_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing tests for layer/channel priority mapping**

Create `src-tauri/src/services/workspace_index_layer_strategy_service_tests.rs`:

```rust
use crate::services::workspace_index_layer_strategy_service::{
    channel_for_layer, priority_for_layer, WorkspaceIndexChannel, WorkspaceIndexLayerKind,
};
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

#[test]
fn maps_hot_file_and_project_layers_to_project_channel() {
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::FileHot),
        WorkspaceIndexChannel::Project
    );
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::ProjectFile),
        WorkspaceIndexChannel::Project
    );
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::ProjectDeep),
        WorkspaceIndexChannel::Project
    );
}

#[test]
fn maps_sdk_api_layer_to_sdk_channel() {
    assert_eq!(
        channel_for_layer(WorkspaceIndexLayerKind::SdkApi),
        WorkspaceIndexChannel::SdkApi
    );
}

#[test]
fn keeps_sdk_api_below_visible_files_and_above_background_deep_work() {
    assert!(
        priority_for_layer(WorkspaceIndexLayerKind::VisibleFiles)
            > priority_for_layer(WorkspaceIndexLayerKind::SdkApi)
    );
    assert!(
        priority_for_layer(WorkspaceIndexLayerKind::SdkApi)
            > WorkspaceIndexTaskPriority::Background
    );
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_strategy_service_tests
```

Expected: FAIL because `workspace_index_layer_strategy_service` does not exist.

- [x] **Step 3: Add the strategy service**

Create `src-tauri/src/services/workspace_index_layer_strategy_service.rs`:

```rust
use crate::services::workspace_index_scheduler_service::WorkspaceIndexTaskPriority;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexLayerKind {
    FileHot,
    VisibleFiles,
    ProjectFile,
    ProjectDeep,
    SdkApi,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceIndexChannel {
    Project,
    SdkApi,
}

pub fn channel_for_layer(layer: WorkspaceIndexLayerKind) -> WorkspaceIndexChannel {
    match layer {
        WorkspaceIndexLayerKind::SdkApi => WorkspaceIndexChannel::SdkApi,
        WorkspaceIndexLayerKind::FileHot
        | WorkspaceIndexLayerKind::VisibleFiles
        | WorkspaceIndexLayerKind::ProjectFile
        | WorkspaceIndexLayerKind::ProjectDeep => WorkspaceIndexChannel::Project,
    }
}

pub fn priority_for_layer(layer: WorkspaceIndexLayerKind) -> WorkspaceIndexTaskPriority {
    match layer {
        WorkspaceIndexLayerKind::FileHot => WorkspaceIndexTaskPriority::ForegroundNavigation,
        WorkspaceIndexLayerKind::VisibleFiles => WorkspaceIndexTaskPriority::VisibleFiles,
        WorkspaceIndexLayerKind::ProjectFile => WorkspaceIndexTaskPriority::FullRefresh,
        WorkspaceIndexLayerKind::SdkApi => WorkspaceIndexTaskPriority::SdkIndexing,
        WorkspaceIndexLayerKind::ProjectDeep => WorkspaceIndexTaskPriority::Background,
    }
}
```

- [x] **Step 4: Register modules**

In `src-tauri/src/lib.rs`, add:

```rust
pub mod workspace_index_layer_strategy_service;

#[cfg(test)]
mod workspace_index_layer_strategy_service_tests;
```

- [x] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_strategy_service_tests
git diff --check
```

Expected: PASS.

---

## Task 2: SDK API-Only Scan Plan

**Files:**
- Create: `src-tauri/src/services/workspace_sdk_api_scan_plan_service.rs`
- Create: `src-tauri/src/services/workspace_sdk_api_scan_plan_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing tests for SDK declaration selection**

Create `src-tauri/src/services/workspace_sdk_api_scan_plan_service_tests.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::services::workspace_sdk_api_scan_plan_service::{
    plan_sdk_api_scan, sdk_api_scan_chunks,
};

#[test]
fn selects_declaration_and_api_source_files_but_excludes_noise() {
    let root = temp_dir("sdk-api-scan");
    write(&root, "ets/component/common.d.ts", "export interface Button {}");
    write(&root, "ets/api/arkui.ts", "export class Text {}");
    write(&root, "samples/demo/index.ets", "export class Sample {}");
    write(&root, "docs/api.md", "# docs");
    write(&root, "build/generated.d.ts", "export interface Generated {}");

    let plan = plan_sdk_api_scan(&root.to_string_lossy()).unwrap();

    assert_eq!(relative_paths(&root, &plan.files), vec![
        "ets/api/arkui.ts",
        "ets/component/common.d.ts",
    ]);

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn chunks_sdk_api_files_deterministically() {
    let files = vec![
        "c.d.ts".to_string(),
        "a.d.ts".to_string(),
        "b.d.ts".to_string(),
    ];

    let chunks = sdk_api_scan_chunks(files, 2);

    assert_eq!(chunks, vec![
        vec!["a.d.ts".to_string(), "b.d.ts".to_string()],
        vec!["c.d.ts".to_string()],
    ]);
}

fn temp_dir(name: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!("arkline-{name}-{suffix}"))
}

fn write(root: &Path, relative: &str, content: &str) {
    let path = root.join(relative);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, content).unwrap();
}

fn relative_paths(root: &Path, files: &[String]) -> Vec<String> {
    files
        .iter()
        .map(|path| {
            Path::new(path)
                .strip_prefix(root)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect()
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_api_scan_plan_service_tests
```

Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement SDK API scan planning**

Create `src-tauri/src/services/workspace_sdk_api_scan_plan_service.rs`:

```rust
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkspaceSdkApiScanPlan {
    pub sdk_path: String,
    pub files: Vec<String>,
}

pub fn plan_sdk_api_scan(sdk_path: &str) -> Result<WorkspaceSdkApiScanPlan, String> {
    let root = Path::new(sdk_path);
    if !root.is_dir() {
        return Ok(WorkspaceSdkApiScanPlan {
            sdk_path: sdk_path.to_string(),
            files: Vec::new(),
        });
    }
    let mut files = Vec::new();
    collect_api_files(root, &mut files)?;
    files.sort();
    Ok(WorkspaceSdkApiScanPlan {
        sdk_path: sdk_path.to_string(),
        files,
    })
}

pub fn sdk_api_scan_chunks(mut files: Vec<String>, chunk_size: usize) -> Vec<Vec<String>> {
    files.sort();
    let size = chunk_size.max(1);
    files.chunks(size).map(|chunk| chunk.to_vec()).collect()
}

fn collect_api_files(directory: &Path, files: &mut Vec<String>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if should_skip_path(&path) {
            continue;
        }
        if path.is_dir() {
            collect_api_files(&path, files)?;
        } else if is_api_declaration_file(&path) {
            files.push(path.to_string_lossy().to_string());
        }
    }
    Ok(())
}

fn should_skip_path(path: &Path) -> bool {
    path_components(path).iter().any(|part| {
        matches!(
            part.as_str(),
            "build" | "dist" | "docs" | "node_modules" | "preview" | "sample" | "samples" | "test" | "tests"
        )
    })
}

fn is_api_declaration_file(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return false;
    };
    if extension == "d.ts" {
        return true;
    }
    matches!(extension, "ets" | "ts")
        && path_components(path).iter().any(|part| matches!(part.as_str(), "api" | "ets" | "component"))
}

fn path_components(path: &Path) -> Vec<String> {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_ascii_lowercase())
        .collect()
}
```

- [x] **Step 4: Register modules**

In `src-tauri/src/lib.rs`, add:

```rust
pub mod workspace_sdk_api_scan_plan_service;

#[cfg(test)]
mod workspace_sdk_api_scan_plan_service_tests;
```

- [x] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_api_scan_plan_service_tests
git diff --check
```

Expected: PASS.

---

## Task 3: SDK API Declaration Parser Contract

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_parser_service.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Test: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`

- [x] **Step 1: Add failing tests for API-only exported/public symbols**

Append to `src-tauri/src/services/workspace_sdk_index_service_tests.rs`:

```rust
#[test]
fn sdk_index_keeps_exported_api_symbols_and_skips_private_implementation_symbols() {
    let root = create_empty_workspace("sdk-api-only");
    let sdk = root.join("openharmony");
    std::fs::create_dir_all(sdk.join("ets").join("component")).unwrap();
    std::fs::write(
        sdk.join("ets").join("component").join("common.d.ts"),
        [
            "export interface Button {",
            "  width(value: number): Button;",
            "  privateInternal(): void;",
            "}",
            "class InternalImpl {",
            "  secret(): void;",
            "}",
        ]
        .join("\n"),
    )
    .unwrap();

    let summary = index_workspace_sdk_symbols(
        &root.to_string_lossy(),
        &sdk.to_string_lossy(),
        "test-sdk",
    )
    .unwrap();

    assert!(summary.symbol_count >= 2);
    let width_hits = query_workspace_sdk_symbols(&root.to_string_lossy(), "width", 8).unwrap();
    assert!(width_hits.iter().any(|hit| hit.title == "width"));
    let secret_hits = query_workspace_sdk_symbols(&root.to_string_lossy(), "secret", 8).unwrap();
    assert!(secret_hits.is_empty());

    std::fs::remove_dir_all(root).unwrap();
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml sdk_index_keeps_exported_api_symbols_and_skips_private_implementation_symbols
```

Expected: FAIL because the current parser indexes non-exported implementation declarations and private members.

- [x] **Step 3: Add API symbol visibility logic**

In `src-tauri/src/services/workspace_sdk_parser_service.rs`, add exported/public filtering:

```rust
fn is_exported_or_public_declaration(trimmed: &str) -> bool {
    trimmed.starts_with("export ")
        || trimmed.starts_with("declare ")
        || trimmed.starts_with("public ")
        || trimmed.starts_with("interface ")
        || trimmed.starts_with("class ")
        || trimmed.starts_with("enum ")
        || trimmed.starts_with("type ")
        || trimmed.starts_with("function ")
}

fn is_private_member(trimmed: &str) -> bool {
    trimmed.starts_with("private ")
        || trimmed.starts_with("protected ")
        || trimmed.contains("@internal")
}
```

Then update `index_sdk_document` so:

```rust
if let Some((kind, name, column)) = declaration_symbol(line_text) {
    if !is_exported_or_public_declaration(trimmed) {
        continue;
    }
    // keep the existing symbol push logic
}

if let Some(container_name) = type_path(&contexts) {
    if is_private_member(trimmed) {
        continue;
    }
    if let Some((kind, name, column)) = member_symbol(trimmed, line_text) {
        // keep existing member push logic
    }
}
```

- [x] **Step 4: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml sdk_index_keeps_exported_api_symbols_and_skips_private_implementation_symbols
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_index_service_tests
git diff --check
```

Expected: PASS.

---

## Task 4: SDK API Cache Key And Skip Path

**Files:**
- Create: `src-tauri/src/services/workspace_sdk_api_cache_service.rs`
- Create: `src-tauri/src/services/workspace_sdk_api_cache_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/lib.rs`

- [x] **Step 1: Write failing cache tests**

Create `src-tauri/src/services/workspace_sdk_api_cache_service_tests.rs`:

```rust
use crate::services::workspace_sdk_api_cache_service::{
    sdk_api_cache_key, sdk_api_manifest_fingerprint,
};

#[test]
fn sdk_api_cache_key_changes_when_sdk_version_or_manifest_changes() {
    let first = sdk_api_cache_key("/sdk", "5.0.0", "parser-v1", "manifest-a");
    let second = sdk_api_cache_key("/sdk", "5.0.1", "parser-v1", "manifest-a");
    let third = sdk_api_cache_key("/sdk", "5.0.0", "parser-v1", "manifest-b");

    assert_ne!(first, second);
    assert_ne!(first, third);
}

#[test]
fn sdk_api_manifest_fingerprint_is_order_independent() {
    let first = sdk_api_manifest_fingerprint(&["b.d.ts".to_string(), "a.d.ts".to_string()]);
    let second = sdk_api_manifest_fingerprint(&["a.d.ts".to_string(), "b.d.ts".to_string()]);

    assert_eq!(first, second);
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_api_cache_service_tests
```

Expected: FAIL because the service does not exist.

- [x] **Step 3: Implement cache helpers**

Create `src-tauri/src/services/workspace_sdk_api_cache_service.rs`:

```rust
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

pub const SDK_API_PARSER_VERSION: &str = "sdk-api-parser-v1";

pub fn sdk_api_manifest_fingerprint(files: &[String]) -> String {
    let mut sorted = files.to_vec();
    sorted.sort();
    let mut hasher = DefaultHasher::new();
    for file in sorted {
        file.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

pub fn sdk_api_cache_key(
    sdk_path: &str,
    sdk_version: &str,
    parser_version: &str,
    manifest_fingerprint: &str,
) -> String {
    let mut hasher = DefaultHasher::new();
    sdk_path.replace('\\', "/").hash(&mut hasher);
    sdk_version.hash(&mut hasher);
    parser_version.hash(&mut hasher);
    manifest_fingerprint.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}
```

- [x] **Step 4: Register modules**

In `src-tauri/src/lib.rs`, add:

```rust
pub mod workspace_sdk_api_cache_service;

#[cfg(test)]
mod workspace_sdk_api_cache_service_tests;
```

- [x] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_api_cache_service_tests
git diff --check
```

Expected: PASS.

---

## Task 5: Chunked SDK API Indexing

**Files:**
- Modify: `src-tauri/src/services/workspace_sdk_index_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/services/workspace_index_continuation_task_service.rs`
- Test: `src-tauri/src/services/workspace_sdk_index_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_worker_service_tests.rs`

- [x] **Step 1: Add failing test for SDK chunk progress**

Append to `src-tauri/src/services/workspace_sdk_index_service_tests.rs`:

```rust
#[test]
fn sdk_api_index_can_index_a_single_chunk() {
    let root = create_empty_workspace("sdk-api-chunk");
    let sdk = root.join("openharmony");
    std::fs::create_dir_all(sdk.join("ets").join("component")).unwrap();
    for index in 0..3 {
        std::fs::write(
            sdk.join("ets").join("component").join(format!("api{index}.d.ts")),
            format!("export interface Api{index} {{ method{index}(): void; }}"),
        )
        .unwrap();
    }
    let files = vec![
        sdk.join("ets").join("component").join("api0.d.ts").to_string_lossy().to_string(),
        sdk.join("ets").join("component").join("api1.d.ts").to_string_lossy().to_string(),
    ];

    let summary = index_workspace_sdk_symbol_chunk(
        &root.to_string_lossy(),
        &sdk.to_string_lossy(),
        "test-sdk",
        &files,
        true,
    )
    .unwrap();

    assert_eq!(summary.indexed_files, 2);
    assert!(summary.symbol_count >= 2);

    std::fs::remove_dir_all(root).unwrap();
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml sdk_api_index_can_index_a_single_chunk
```

Expected: FAIL because `index_workspace_sdk_symbol_chunk` does not exist.

- [x] **Step 3: Implement chunk API**

In `src-tauri/src/services/workspace_sdk_index_service.rs`, add:

```rust
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSdkIndexChunkSummary {
    pub indexed_files: usize,
    pub symbol_count: usize,
}

pub fn index_workspace_sdk_symbol_chunk(
    root_path: &str,
    sdk_path: &str,
    sdk_version: &str,
    files: &[String],
    replace_existing: bool,
) -> Result<WorkspaceSdkIndexChunkSummary, String> {
    if !Path::new(root_path).is_dir() || !Path::new(sdk_path).is_dir() {
        return Ok(WorkspaceSdkIndexChunkSummary {
            indexed_files: 0,
            symbol_count: 0,
        });
    }
    let mut connection = open_index_store(root_path)?;
    ensure_workspace_index_schema(&connection)?;
    let root_key = normalize_index_path(root_path);
    let sdk_key = normalize_index_path(sdk_path);
    let symbols = collect_sdk_symbols_from_files(files)?;
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    if replace_existing {
        transaction
            .execute(
                "delete from workspace_sdk_symbols where root_path = ?1 and sdk_path = ?2 and sdk_version = ?3",
                params![root_key, sdk_key, sdk_version],
            )
            .map_err(|error| error.to_string())?;
    }
    insert_sdk_symbols(&transaction, &root_key, &sdk_key, sdk_version, &symbols)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(WorkspaceSdkIndexChunkSummary {
        indexed_files: files.len(),
        symbol_count: symbols.len(),
    })
}
```

Also add helper `insert_sdk_symbols(...)` by moving the existing insert loop from `index_workspace_sdk_symbols` into a reusable function.

- [x] **Step 4: Replace one-shot SDK task with scan-plan chunks**

In `workspace_index_worker_service.rs`, update `IndexSdk` handling:

```rust
let plan = plan_sdk_api_scan(&sdk_path)?;
let chunks = sdk_api_scan_chunks(plan.files, 512);
let Some(first_chunk) = chunks.first() else {
    let summary = index_workspace_sdk_symbols(&task.root_path, &sdk_path, &sdk_version)?;
    return Ok(Some(sdk_task_result(task, started_at, summary.symbol_count, 1, 1, "ready", None)));
};
let summary = index_workspace_sdk_symbol_chunk(
    &task.root_path,
    &sdk_path,
    &sdk_version,
    first_chunk,
    true,
)?;
```

If more chunks remain, return a partial result with `progress_current = 1`, `progress_total = chunks.len()`, and a continuation carrying remaining SDK files. Use a new continuation reason prefix `sdk-api-continuation`.

- [x] **Step 5: Add worker test for SDK below foreground**

In `workspace_index_worker_service_tests.rs`, add a test that schedules:

- one `IndexSdk` task with `SdkIndexing`
- one `ChangedPaths` task with `ForegroundNavigation`

Expected result: foreground result is emitted before SDK result.

- [x] **Step 6: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml sdk_api_index_can_index_a_single_chunk
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests
git diff --check
```

Expected: PASS.

---

## Task 6: Four-Layer Readiness Projection

**Files:**
- Modify: `src-tauri/src/services/workspace_index_layer_readiness_service.rs`
- Test: `src-tauri/src/services/workspace_index_layer_readiness_service_tests.rs`

- [x] **Step 1: Add failing readiness test**

Append to `workspace_index_layer_readiness_service_tests.rs`:

```rust
#[test]
fn readiness_report_exposes_four_index_layers() {
    let root = unique_temp_dir("four-layer-readiness");
    std::fs::create_dir_all(&root).unwrap();
    let root_path = root.to_string_lossy().to_string();

    let report = get_workspace_index_layer_readiness(&root_path, None).unwrap();
    let layer_names = report
        .layers
        .iter()
        .map(|layer| layer.layer.as_str())
        .collect::<Vec<_>>();

    assert!(layer_names.contains(&"fileHot"));
    assert!(layer_names.contains(&"projectFile"));
    assert!(layer_names.contains(&"projectDeep"));
    assert!(layer_names.contains(&"sdkApi"));

    std::fs::remove_dir_all(root).unwrap();
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml readiness_report_exposes_four_index_layers
```

Expected: FAIL because current layer names are not the four target layers.

- [x] **Step 3: Update readiness projection**

In `workspace_index_layer_readiness_service.rs`, ensure returned layers include:

```rust
"fileHot"
"projectFile"
"projectDeep"
"sdkApi"
```

Map existing storage evidence:

- `fileHot`: current file readiness when a path is provided; otherwise best effort from file/symbol index.
- `projectFile`: file table + resolved symbol table.
- `projectDeep`: content index + references + dependency graph evidence.
- `sdkApi`: `workspace_sdk_symbols` + active SDK metadata.

- [x] **Step 4: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_readiness_service_tests
git diff --check
```

Expected: PASS.

---

## Task 7: Query Facade Evidence For Layered Results

**Files:**
- Modify: `src-tauri/src/services/workspace_index_facade_search_service.rs`
- Modify: `src-tauri/src/services/workspace_index_facade_completion_service.rs`
- Test: `src-tauri/src/services/workspace_index_facade_search_tests.rs`
- Test: `src-tauri/src/services/workspace_index_facade_completion_tests.rs`

- [x] **Step 1: Add failing search explain test**

Append to `workspace_index_facade_search_tests.rs`:

```rust
#[test]
fn search_everywhere_explain_names_project_and_sdk_layers() {
    let root = create_empty_workspace("search-layer-explain");
    let root_path = root.to_string_lossy().to_string();
    let runtime = WorkspaceIndexRuntime::default();

    let envelope = query_facade_search_everywhere_with_readiness(
        &runtime,
        &root_path,
        "Button",
        "all",
        20,
    )
    .unwrap();

    assert!(envelope.explain.iter().any(|line| line.contains("layer:projectFile")));
    assert!(envelope.explain.iter().any(|line| line.contains("layer:sdkApi")));

    std::fs::remove_dir_all(root).unwrap();
}
```

- [x] **Step 2: Run the failing test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml search_everywhere_explain_names_project_and_sdk_layers
```

Expected: FAIL because explain lines do not name layered sources.

- [x] **Step 3: Add layered explain lines**

In `workspace_index_facade_search_service.rs`, extend explain construction with:

```rust
explain.push(format!("layer:projectFile:{}", readiness_state_label(&readiness)));
explain.push(format!("layer:sdkApi:{}", sdk_readiness_label(&request_root_path)?));
```

Use existing readiness helpers where possible. If helper names differ, create a small private helper in the same file and keep the file under 500 lines by moving helper logic to a new focused service if needed.

- [x] **Step 4: Add completion explain/readiness test**

In `workspace_index_facade_completion_tests.rs`, add a test proving completion candidates can include SDK API candidates while project file readiness remains independent.

- [x] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests
git diff --check
```

Expected: PASS.

---

## Task 8: Performance And Regression Gates

**Files:**
- Modify: `src-tauri/src/services/workspace_interaction_perf_fixture_tests.rs`
- Modify: `src-tauri/src/services/workspace_large_project_index_tests.rs`
- Modify: `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`

- [x] **Step 1: Add large-project regression for SDK not blocking active file**

In `workspace_large_project_index_tests.rs`, add:

```rust
#[test]
fn sdk_api_indexing_does_not_block_foreground_file_readiness() {
    let fixture = create_large_workspace_fixture("sdk-does-not-block-foreground", 2_000).unwrap();
    let runtime = WorkspaceIndexRuntime::default();
    let mut manager = WorkspaceIndexManager::default();

    manager.schedule_sdk_index(&fixture.root_path, &fixture.sdk_path, "test-sdk").unwrap();
    manager.schedule_foreground_navigation(&fixture.root_path, &fixture.app_path).unwrap();

    manager.run_index_worker_once(&runtime, |_| {}).unwrap();

    let readiness = get_workspace_index_file_readiness(&fixture.root_path, &fixture.app_path).unwrap();
    assert_eq!(readiness.file_index, "ready");
    assert_eq!(readiness.symbol_index, "ready");
}
```

Use existing fixture helpers in the file. If method names differ, adapt to the current manager helper names used by nearby tests.

- [x] **Step 2: Extend interaction profile summary**

In `workspace_interaction_perf_fixture_tests.rs`, add fields:

```rust
sdk_api_first_progress_ms: u128,
foreground_during_sdk_ms: u128,
```

Include them in `summary()` and `violations()` with thresholds:

```rust
const SDK_PROGRESS_THRESHOLD_MS: u128 = 1_500;
const FOREGROUND_DURING_SDK_THRESHOLD_MS: u128 = 800;
```

- [x] **Step 3: Keep strict mode opt-in**

Ensure `strict_perf_enabled()` remains the only path that asserts violations:

```rust
if strict_perf_enabled() {
    assert!(report.violations().is_empty(), "interaction smoothness violations: {:?}", report.violations());
}
```

- [x] **Step 4: Update tracker doc**

In `docs/superpowers/plans/2026-07-01-index-core-goal-tracker.md`, add to Current Baseline after implementation:

```markdown
- Four-layer index readiness and dual-channel project/SDK parsing strategy.
- SDK API-only scan plan with chunked progress and foreground-safe scheduling.
```

- [x] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
cargo test --manifest-path src-tauri/Cargo.toml verifies_real_project_interaction_smoothness -- --ignored --nocapture
git diff --check
```

Expected: normal test passes; ignored profile skips when `ARKLINE_PROFILE_ROOT` is unset; strict performance assertions only run when `ARKLINE_STRICT_PERF=1`.

---

## Recommended Execution Order

1. Task 1: Strategy model.
2. Task 2: SDK API scan plan.
3. Task 3: API-only parser filtering.
4. Task 4: SDK cache key.
5. Task 5: Chunked SDK indexing and scheduling.
6. Task 6: Four-layer readiness projection.
7. Task 7: Query facade explain evidence.
8. Task 8: Performance/regression gates.

This order keeps user-visible responsiveness protected while moving SDK parsing out of the project-file critical path.

## Verification Bundle

Run before final completion:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_strategy_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_api_scan_plan_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_api_cache_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_sdk_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_worker_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_layer_readiness_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_search_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_completion_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_large_project_index_tests
pnpm build
git diff --check
```

Expected: all commands pass, touched code files stay under 500 lines, and SDK API indexing no longer blocks foreground project file readiness.

## Self-Review

- Spec coverage: Covers four index layers, dual parsing channels, SDK API-only parsing, chunked SDK progress, readiness, facade explain evidence, and performance gates.
- Placeholder scan: No unresolved placeholder markers or deferred ambiguous steps remain; each task has exact file paths, commands, and expected results.
- Type consistency: Layer names are `fileHot`, `projectFile`, `projectDeep`, `sdkApi`; channel names are `Project` and `SdkApi`; priority mapping uses existing `WorkspaceIndexTaskPriority`.
