# Index Schema Version Policy Phase 112

## Goal

Add a schema-version policy read model so diagnostics can explain whether each
index domain is compatible, missing a version row, or needs rebuild.

## Why This Phase

The indexing roadmap calls out rebuild triggers for incompatible content,
symbol, SDK, and related index versions. Phase 111 created a focused schema
version registry. This phase adds the next layer: a deterministic policy view
over persisted versions, exposed through diagnostics for future UI repair flows.

## Changes

- Added `WorkspaceIndexSchemaVersionStatus` and
  `WorkspaceIndexSchemaVersionAction`.
- Added `plan_workspace_index_schema_version_actions`.
- Added `schema_version_actions` to backend diagnostics.
- Added `schemaVersionActions` to the frontend diagnostics contract and test
  fixtures.
- Diagnostics now reports `compatible`, `missing-version`, and
  `needs-rebuild` actions per schema domain.

## Verification

- `cargo test workspace_index_schema_version_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_diagnostics_service_tests --manifest-path src-tauri/Cargo.toml`
- `pnpm build`
- `pnpm check:fast`

## Next Slice

The next schema phase can consume these actions inside repair/health services:
`needs-rebuild` should produce a clear rebuild action, while `missing-version`
can remain informational for newly created or partially initialized databases.
