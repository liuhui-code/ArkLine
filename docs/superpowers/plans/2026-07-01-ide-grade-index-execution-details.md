# IDE-Grade Index Execution Details Archive

> Historical execution slices extracted from `2026-07-01-ide-grade-index-roadmap.md` to keep each planning file below 500 lines. The main roadmap remains the source of truth for current status and next steps.

## Current Next Step

Continue Phase 2 before broadening scope. The current goal is to make ArkLine's index core behave like a durable IDE knowledge layer, not a set of disconnected query helpers. Each slice must add one observable capability, one focused backend test group, and one small service boundary when the touched file is close to 500 lines.

Immediate execution order:

1. Split near-limit test files before adding more behavior.
2. Expand receiver type inference for project members from imports, generics, async returns, and flow-sensitive narrowing.
3. Normalize reference confidence values and expose them through usages and definition paths.
4. Add the unified index facade only after definition and usages share the same caret-to-symbol path.
5. Move completion onto the same symbol/reference/readiness foundation instead of adding another fallback chain.

## Detailed Execution Plan

### Slice A: Stabilize Test Boundaries

**Goal:** Keep future work maintainable by splitting near-limit test files before adding more indexing behavior.

**Files:**

- Create: `src-tauri/src/services/workspace_definition_member_query_tests.rs`
- Create: `src-tauri/src/services/workspace_reference_receiver_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/services/workspace_definition_query_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_reference_index_service_tests.rs`

Steps:

- [x] Move member-definition tests from `workspace_definition_query_service_tests.rs` into `workspace_definition_member_query_tests.rs`.
- [x] Move receiver-reference tests from `workspace_reference_index_service_tests.rs` into `workspace_reference_receiver_tests.rs`.
- [x] Register the two new test modules in `src-tauri/src/lib.rs`.
- [x] Run focused tests:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_member_query_tests workspace_reference_receiver_tests
```

- [x] Run line-count guard:

```bash
wc -l src-tauri/src/services/workspace_definition_query_service_tests.rs src-tauri/src/services/workspace_definition_member_query_tests.rs src-tauri/src/services/workspace_reference_index_service_tests.rs src-tauri/src/services/workspace_reference_receiver_tests.rs
```

Expected result: each file stays below 500 lines.

### Slice B: Imported Receiver Type Binding

**Goal:** Resolve project member access when the receiver type is imported from another file.

**Files:**

- Modify: `src-tauri/src/services/workspace_reference_member_index_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_receiver_tests.rs`
- Modify: `src-tauri/src/services/workspace_definition_member_query_tests.rs`
- Modify: `src-tauri/src/services/workspace_usage_query_service_tests.rs`

Steps:

- [x] Add a failing reference test where an aliased imported `UserService` resolves `service.load()` to the imported class member even when another same-named class sorts first.
- [x] Add a failing definition test where Ctrl+Click on `load` jumps to the imported class member declaration.
- [x] Add a failing usage test where Find Usages on `load` returns member usages from the imported receiver.
- [x] Extend receiver type inference to resolve imported type names through `workspace_resolved_symbols.target_symbol_id`.
- [x] Keep unresolved imported receivers as `unresolvedLikely` instead of guessing by name.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_receiver_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_member_query_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests
```

### Slice C: Generic And Async Receiver Type Binding

**Goal:** Cover common IDE-grade member cases without attempting full type checking.

**Files:**

- Modify: `src-tauri/src/services/workspace_reference_receiver_type_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_receiver_tests.rs`
- Modify: `src-tauri/src/services/workspace_definition_member_query_tests.rs`

Steps:

- [x] Add a failing test for `const box: Box<UserService>; box.value.load()` where the configured generic owner exposes `value: T`.
- [x] Add a failing test for `async function create(): Promise<UserService>` followed by `const service = await create(); service.load()`.
- [x] Add a small return-type normalizer that unwraps `Promise<T>` and direct `T`.
- [x] Add a generic-member resolver only for explicit field declarations such as `value: T`; avoid speculative inference.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_receiver_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_member_query_tests
```

### Slice D: Confidence Contract

**Goal:** Make every indexed reference explain how trustworthy it is.

**Files:**

- Modify: `src-tauri/src/services/workspace_reference_index_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_identifier_index_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_member_index_service.rs`
- Modify: `src-tauri/src/services/workspace_usage_query_service.rs`
- Modify: `src-tauri/src/services/workspace_reference_index_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_usage_query_service_tests.rs`

Steps:

- [x] Normalize confidence values to `exact`, `resolvedAlias`, `memberResolved`, `localScope`, and `unresolvedLikely`.
- [x] Add tests proving declaration references are `exact`.
- [x] Add tests proving imported alias usages are `resolvedAlias`.
- [x] Add tests proving member receiver matches are `memberResolved`.
- [x] Add tests proving unresolved member guesses remain `unresolvedLikely`.
- [x] Sort usage results by confidence, then path, then range.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_index_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_reference_receiver_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests
```

### Slice E: Unified Index Facade

**Goal:** Put definition, usages, Search Everywhere, file symbols, completion, and global search behind one readiness-aware query contract.

**Files:**

- Create: `src-tauri/src/services/workspace_index_facade_service.rs`
- Create: `src-tauri/src/services/workspace_index_facade_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src-tauri/src/commands/workspace_definition.rs`

Steps:

- [x] Define facade request structs for `Definition`, `Usages`, `SearchEverywhere`, `FileSymbols`, `Completion`, and `TextSearch`.
- [x] Define one response envelope containing `items`, `readiness`, `confidence`, and `explain`.
- [x] Route definition and usages through the facade first because they already share reference identity.
- [x] Add compatibility wrappers so existing frontend calls keep working.
- [x] Add tests for stale readiness, ready results, and unsupported scope errors.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_facade_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_query_service_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_definition_member_query_tests
cargo test --manifest-path src-tauri/Cargo.toml workspace_usage_query_service_tests
```

### Slice F: Semantic Completion Foundation

**Goal:** Make completion consume durable index facts and local scope facts with predictable ranking.

**Files:**

- Create: `src-tauri/src/services/workspace_completion_semantic_service.rs`
- Create: `src-tauri/src/services/workspace_completion_semantic_service_tests.rs`
- Modify: `src-tauri/src/lib.rs`
- Deferred: `src/features/workspace/workspace-api.ts` workspace-aware command wiring follows after the backend service is split below 500 lines.

Steps:

- [x] Add keyword candidates for `public`, `private`, `protected`, `readonly`, `static`, `async`, `await`, `export`, `import`, `class`, `interface`, `struct`, `function`, `let`, and `const`.
- [x] Add local scope candidates from the active file.
- [x] Add member candidates for `receiver.` using the receiver type service.
- [x] Add importable project symbols and active SDK API candidates from SQLite.
- [x] De-duplicate by symbol id first, then label/kind.
- [x] Return import insertion metadata without applying edits.
- [x] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_completion_semantic_service_tests
pnpm test -- --run tests/frontend/completion-candidate-provider.test.ts tests/frontend/indexed-completion-model.test.ts
```

Follow-up for frontend integration:

- [x] Split `workspace_completion_semantic_service.rs` into focused parser/query modules before adding command glue.
- [x] Add a workspace-aware Tauri command that accepts `rootPath` plus `LanguageQueryRequest`.
- [x] Add `WorkspaceApi.semanticCompleteSymbol` or equivalent without changing the legacy language-service `complete_symbol` contract.
- [x] Route the editor completion provider through `semanticCompleteSymbol` first, with legacy `completeSymbol` fallback.

### Slice G: Scheduler State Machine

**Goal:** Make indexing predictable for large projects and foreground IDE interactions.

**Files:**

- Create: `src-tauri/src/services/workspace_index_state_machine_service.rs`
- Create: `src-tauri/src/services/workspace_index_state_machine_service_tests.rs`
- Modify: `src-tauri/src/services/workspace_index_manager_service.rs`
- Modify: `src-tauri/src/services/workspace_index_worker_service.rs`
- Modify: `src-tauri/src/lib.rs`

Steps:

- [ ] Add states: `queued`, `running`, `cancelling`, `cancelled`, `ready`, `partial`, `failed`, and `superseded`.
- [ ] Add priorities: foreground navigation, completion, visible files, changed files, full refresh, SDK indexing.
- [ ] Add generation checks so stale work cannot publish fresh readiness.
- [ ] Add bounded batches so large-project indexing yields between chunks.
- [ ] Add tests for superseding, cancellation, retry, and priority ordering.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_state_machine_service_tests workspace_index_worker_service_tests
```

### Slice H: Health And Repair Surface

**Goal:** Give users and developers a way to understand why IDE features are missing or stale.

**Files:**

- Create: `src-tauri/src/services/workspace_index_health_service.rs`
- Create: `src-tauri/src/services/workspace_index_health_service_tests.rs`
- Modify: `src-tauri/src/commands/workspace.rs`
- Modify: `src/features/workspace/workspace-api.ts`

Steps:

- [ ] Report file count, symbol count, reference count, SDK API count, unresolved import count, parse failure count, and queue state.
- [ ] Add repair actions: rebuild project index, rebuild SDK index, inspect excluded path, inspect parser failure.
- [ ] Add tests for healthy, partial, stale, and failed index states.
- [ ] Keep UI presentation separate from the backend health contract.
- [ ] Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace_index_health_service_tests
pnpm test -- --run tests/frontend/workspace-api.test.ts
```
