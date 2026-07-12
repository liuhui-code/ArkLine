# Dependency Graph Resolver Phase 103

## Goal

Move relative import resolution out of `workspace_dependency_graph_service.rs`.

## Why

Dependency graph indexing is part of the deep project layer used by incremental refresh and large-project responsiveness. The main graph service still mixed SQL writes, graph traversal, status metadata, and path resolution. Import resolution is a pure path concern and will need future expansion for package aliases and build configuration rules.

## Scope

- Add `workspace_dependency_graph_resolver_service.rs`.
- Move relative module detection and relative import candidate resolution into the helper.
- Preserve existing `.ets`, `.ts`, `.d.ts`, and directory `index.ets`/`index.ts` candidate behavior.
- Add focused tests for file candidates, directory index candidates, explicit extensions, and non-relative package imports.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_resolver_service_tests`
- `cargo test --manifest-path src-tauri/Cargo.toml workspace_dependency_graph_service_tests`
- `pnpm check:fast`
