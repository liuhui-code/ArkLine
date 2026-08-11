# Core-First Index Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a 20k workspace reach verified content-core coverage under continuous IDE interaction by separating core, stub, and substring publications into resumable stages.

**Architecture:** Keep the sidecar as a parallel artifact producer and retain one SQLite writer actor. Extend the persisted catalog cursor from paired slices to ordered full-catalog phases. Core publication consumes the writer first; stub and substring are later capability-specific background stages.

**Tech Stack:** Rust, Tauri, SQLite WAL, existing semantic sidecar, pnpm/Vite, GitHub Actions Windows packaged soak.

---

### Task 1: Add Ordered Catalog Cursor Phases (Completed)

**Files:**
- Modify: `src-tauri/src/services/workspace_index_deep_refresh_cursor_service.rs`
- Modify: `src-tauri/src/services/workspace_index_catalog_refresh_worker_service.rs`
- Test: `src-tauri/src/services/workspace_index_deep_refresh_cursor_service.rs`
- Test: `src-tauri/src/services/workspace_index_catalog_refresh_worker_service.rs`

- [ ] **Step 1: Write failing cursor transition tests**

```rust
#[test]
fn advances_within_content_before_starting_stub() {
    let content = cursor(WorkspaceIndexDeepRefreshPhase::Content, 12);
    let next = advance_deep_refresh_cursor(&content, 19);
    assert_eq!(next.phase, WorkspaceIndexDeepRefreshPhase::Content);
    assert_eq!(next.last_file_id, 19);
}

#[test]
fn starts_the_next_full_catalog_phase_at_the_beginning() {
    let content = cursor(WorkspaceIndexDeepRefreshPhase::Content, 19);
    let stub = start_next_deep_refresh_phase(&content).unwrap();
    assert_eq!(stub.phase, WorkspaceIndexDeepRefreshPhase::Stub);
    assert_eq!(stub.last_file_id, 0);
    assert_eq!(stub.batch_last_file_id, None);
}
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `cargo test deep_refresh_cursor --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: FAIL because the existing cursor changes directly from `Content` to
`Stub` for each batch and has no `start_next_deep_refresh_phase` helper.

- [ ] **Step 3: Implement three full-catalog phases**

```rust
pub(crate) enum WorkspaceIndexDeepRefreshPhase {
    Content,
    Stub,
    Substring,
}

pub(crate) fn advance_deep_refresh_cursor(
    cursor: &WorkspaceIndexDeepRefreshCursor,
    batch_last_file_id: i64,
) -> WorkspaceIndexDeepRefreshCursor {
    WorkspaceIndexDeepRefreshCursor {
        last_file_id: batch_last_file_id,
        batch_last_file_id: None,
        ..cursor.clone()
    }
}

pub(crate) fn start_next_deep_refresh_phase(
    cursor: &WorkspaceIndexDeepRefreshCursor,
) -> Option<WorkspaceIndexDeepRefreshCursor> {
    let phase = match cursor.phase {
        WorkspaceIndexDeepRefreshPhase::Content => WorkspaceIndexDeepRefreshPhase::Stub,
        WorkspaceIndexDeepRefreshPhase::Stub => WorkspaceIndexDeepRefreshPhase::Substring,
        WorkspaceIndexDeepRefreshPhase::Substring => return None,
    };
    Some(WorkspaceIndexDeepRefreshCursor {
        phase,
        last_file_id: 0,
        batch_last_file_id: None,
        ..cursor.clone()
    })
}
```

In `refresh_catalog_deep_layer_chunk`, an empty content or stub page saves the
next phase and returns `CATALOG_DEEP_REFRESH_PROGRESS_MESSAGE`; an empty
substring page completes and clears the catalog. Use `batch.path_budget` for
every phase and remove the paired-range special case.

- [ ] **Step 4: Run cursor and catalog worker tests**

Run: `cargo test 'deep_refresh_cursor|catalog_refresh_worker' --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: PASS with content processing a full catalog before any stub page is
published, followed by a full substring pass.

- [ ] **Step 5: Commit the cursor stage**

```bash
git add src-tauri/src/services/workspace_index_deep_refresh_cursor_service.rs \
  src-tauri/src/services/workspace_index_catalog_refresh_worker_service.rs
git commit -m "feat(index): stage catalog deep refresh layers"
```

### Task 2: Add Explicit Content Publication Modes (Completed)

**Files:**
- Modify: `src-tauri/src/services/workspace_index_writer_actor_service.rs`
- Modify: `src-tauri/src/services/workspace_index_writer_publication_service.rs`
- Modify: `src-tauri/src/services/workspace_index_writer_actor_metric_service.rs`
- Modify: `src-tauri/src/indexer_host/runtime_content.rs`
- Test: `src-tauri/src/services/workspace_index_writer_content_layer_tests.rs`

- [ ] **Step 1: Write failing writer tests**

```rust
#[test]
fn core_only_publication_removes_its_artifact_without_building_trigrams() {
    let result = actor.publish(WorkspaceIndexPublicationRequest::content(
        root_path.clone(), descriptor.clone(), PublicationPriority::Background,
        WorkspaceIndexPublicationKind::ContentCoreOnly,
    ), || false);
    assert!(matches!(result, WorkspaceIndexPublicationAttempt::Applied(_)));
    assert!(!Path::new(&descriptor.path).exists());
    assert_eq!(trigram_count(&root_path), 0);
}

#[test]
fn substring_only_publication_does_not_rewrite_content_core() {
    let core_generation = content_generation(&root_path);
    publish_substring_only(&actor, &root_path, descriptor);
    assert_eq!(content_generation(&root_path), core_generation);
    assert_eq!(trigram_count(&root_path), 1);
}
```

- [ ] **Step 2: Run writer content tests and verify failure**

Run: `cargo test writer_actor --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: FAIL because `ContentCoreOnly` and `ContentSubstringOnly` do not yet
exist and the writer retains every `ContentCore` artifact for detached work.

- [ ] **Step 3: Implement publication mode dispatch**

```rust
pub(crate) enum WorkspaceIndexPublicationKind {
    Default,
    ContentCore,
    ContentCoreOnly,
    ContentSubstring,
}

let retain_artifact = result.is_ok()
    && envelope.request.kind == WorkspaceIndexPublicationKind::ContentCore;
```

Map `ContentCoreOnly` to `publish_prepared_workspace_content_core_chunk` and
`ContentSubstring` to `publish_prepared_workspace_content_substring_chunk`.
Extend `IndexerHostRuntime::refresh_content_chunk_with_priority` with a mode
argument: `CoreOnly` publishes `ContentCoreOnly`; `CoreAndSubstring` retains
the existing behavior; `SubstringOnly` publishes only the substring artifact.
Record `ContentCoreOnly` in the existing core writer metrics.

- [ ] **Step 4: Run writer content tests**

Run: `cargo test writer_actor --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: PASS with no retained core-only artifacts and no core rewrite in the
substring-only path.

- [ ] **Step 5: Commit the publication stage**

```bash
git add src-tauri/src/indexer_host/runtime_content.rs \
  src-tauri/src/services/workspace_index_writer_actor_service.rs \
  src-tauri/src/services/workspace_index_writer_publication_service.rs \
  src-tauri/src/services/workspace_index_writer_actor_metric_service.rs \
  src-tauri/src/services/workspace_index_writer_content_layer_tests.rs
git commit -m "feat(index): separate core and substring publications"
```

### Task 3: Bind Cursor Phases To Publication Modes (Completed)

**Files:**
- Modify: `src-tauri/src/services/workspace_index_deep_sidecar_service.rs`
- Modify: `src-tauri/src/services/workspace_index_catalog_refresh_worker_service.rs`
- Test: `src-tauri/src/services/workspace_index_worker_budget_integration_tests.rs`
- Test: `src-tauri/src/services/workspace_index_worker_sidecar_fallback_tests.rs`

- [ ] **Step 1: Write a failing phase-to-mode integration test**

```rust
#[test]
fn catalog_content_phase_publishes_core_without_stub_or_substring() {
    run_catalog_phase(WorkspaceIndexDeepRefreshPhase::Content);
    assert_eq!(ready_content_file_count(&sqlite_path), 1);
    assert_eq!(ready_stub_file_count(&sqlite_path), 0);
    assert_eq!(trigram_count(&sqlite_path), 0);
}
```

- [ ] **Step 2: Run the test and verify failure**

Run: `cargo test catalog_content_phase_publishes_core --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: FAIL because content and stub are currently paired and content always
queues detached substring work.

- [ ] **Step 3: Route each phase through one sidecar operation**

```rust
match phase {
    WorkspaceIndexDeepRefreshPhase::Content => refresh_content_chunks(
        indexer, task, token, indexed_generation, changed_paths, &[],
        ContentPublicationMode::CoreOnly, ui_latency_sensitive_at_start,
        is_ui_latency_sensitive,
    ),
    WorkspaceIndexDeepRefreshPhase::Stub => refresh_stub_chunks(/* existing args */),
    WorkspaceIndexDeepRefreshPhase::Substring => refresh_content_chunks(
        indexer, task, token, indexed_generation, changed_paths, &[],
        ContentPublicationMode::SubstringOnly, ui_latency_sensitive_at_start,
        is_ui_latency_sensitive,
    ),
}
```

Do not call `refresh_sidecar_layers` from catalog continuation work. Keep the
existing paired function only for non-catalog changed-path compatibility until
that path is separately migrated.

- [ ] **Step 4: Run integration regressions**

Run: `cargo test workspace_index_worker_budget --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: PASS. Verify continuous UI activity limits each sidecar publication
without re-pairing the three layer commits.

- [ ] **Step 5: Commit the phase binding**

```bash
git add src-tauri/src/services/workspace_index_deep_sidecar_service.rs \
  src-tauri/src/services/workspace_index_catalog_refresh_worker_service.rs \
  src-tauri/src/services/workspace_index_worker_budget_integration_tests.rs \
  src-tauri/src/services/workspace_index_worker_sidecar_fallback_tests.rs
git commit -m "feat(index): prioritize core catalog coverage"
```

### Task 4: Preserve Query Capability Truthfulness (Completed)

**Files:**
- Modify: `src-tauri/src/services/workspace_content_query_service.rs`
- Modify: `src-tauri/src/services/workspace_index_layer_readiness_service.rs`
- Modify: `src-tauri/src/services/workspace_index_explain_service.rs`
- Test: `src-tauri/src/services/workspace_content_index_service_tests.rs`
- Test: `src-tauri/src/services/workspace_index_layer_readiness_service_tests.rs`

- [ ] **Step 1: Write failing partial-capability tests**

```rust
#[test]
fn core_ready_substring_pending_search_reports_partial_with_fts_results() {
    mark_content_core_ready(&root_path, "Entry.ets");
    let result = search_indexed_workspace_content(&request(&root_path, "Entry"))?;
    assert!(!result.matches.is_empty());
    assert!(result.partial);
}

#[test]
fn readiness_reports_auxiliary_indexing_after_core_is_ready() {
    let layer = content_substring_layer(&connection, &root_key, None)?;
    assert_eq!(layer.status, WorkspaceIndexLayerStatus::Partial);
    assert_eq!(layer.reason.as_deref(), Some("auxiliaryIndexing"));
}
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cargo test 'core_ready_substring_pending|auxiliary_indexing' --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: FAIL because query/readiness evidence does not currently distinguish
core-ready auxiliary work from a generic partial index.

- [ ] **Step 3: Return explicit core and auxiliary capability evidence**

Add `auxiliaryIndexing` as the substring-layer reason when content core is
ready but substring rows are pending. Preserve existing FTS fallback for
word/prefix queries. For arbitrary substrings, retain `partial` and include
`ContentSubstring` in the skipped-index explanation rather than reporting an
empty result as complete.

- [ ] **Step 4: Run query and readiness tests**

Run: `cargo test 'workspace_content_index|workspace_index_layer_readiness' --lib --target-dir /private/tmp/arkline-index-contract-target`

Expected: PASS with a correct partial result and no false full-coverage claim.

- [ ] **Step 5: Commit the capability stage**

```bash
git add src-tauri/src/services/workspace_content_query_service.rs \
  src-tauri/src/services/workspace_index_layer_readiness_service.rs \
  src-tauri/src/services/workspace_index_explain_service.rs \
  src-tauri/src/services/workspace_content_index_service_tests.rs \
  src-tauri/src/services/workspace_index_layer_readiness_service_tests.rs
git commit -m "feat(index): report auxiliary search readiness"
```

### Task 5: Validate Windows Throughput And Final Semantics

**Files:**
- Modify: `docs/superpowers/plans/2026-08-09-large-workspace-query-and-index-convergence.md`
- Test: `.github/workflows/windows-packaged-soak.yml`

- [ ] **Step 1: Run local regression gates**

Run:

```bash
cd src-tauri && cargo test workspace_index_ --lib \
  --target-dir /private/tmp/arkline-index-contract-target
cd .. && pnpm build && pnpm check:line-count && git diff --check
```

Expected: all workspace-index tests pass, production bundle builds, all source
files remain at or below 500 lines, and no whitespace errors exist.

- [ ] **Step 2: Run Windows 20k packaged gate**

Run:

```bash
gh workflow run windows-packaged-soak.yml --ref main \
  -f fixture_profile=medium -f duration_minutes=30 -f run_full_soak=true
```

Expected: `indexedContentFileCount` reaches the fixture file count;
`coreIndexCoverageVerified` is true; crash, unresponsive, stale apply, and
search miss counts are zero; the workflow reaches the real Harmony semantic
smoke stage.

- [ ] **Step 3: Inspect artifacts instead of workflow color alone**

Run:

```bash
gh run download <run-id> -D /private/tmp/arkline-core-first-soak
jq '{summary, indexCoverage, writer:(.diagnostics[-1].publicationWriterMetrics)}' \
  /private/tmp/arkline-core-first-soak/arkline-packaged-soak-evidence/packaged-soak-report.json
```

Expected: `contentCorePublicationCount` advances without equal early
substring/stub pressure, core coverage is verified, and the report contains no
strict gate failure.

- [ ] **Step 4: Record results and commit**

Update the convergence plan with the run ID, summary values, artifact location,
and any residual non-core limitations. Then run:

```bash
git add docs/superpowers/plans/2026-08-09-large-workspace-query-and-index-convergence.md
git commit -m "docs(index): record core-first gate evidence"
```
