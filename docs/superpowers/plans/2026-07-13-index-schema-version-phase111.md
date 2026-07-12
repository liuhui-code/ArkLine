# Index Schema Version Phase 111

## Goal

Move workspace index schema domain-version ownership out of the monolithic
schema service so future explicit migrations and incompatible-version rebuild
policies have a focused home.

## Why This Phase

The indexing roadmap still lists schema versioning and per-domain migration
policy as a long-term gap. `workspace_index_schema_service.rs` was 482 lines and
mixed table creation SQL with the domain-version registry. Keeping those
concerns separate makes later migration/version-invalidation work safer.

## Changes

- Added `workspace_index_schema_version_service`.
- Moved schema-version table creation, known domain registry, version recording,
  and version loading into that service.
- Kept `load_workspace_index_schema_versions` re-exported from
  `workspace_index_schema_service` so existing callers stay stable.
- Reduced `workspace_index_schema_service.rs` from 482 lines to 416 lines.

## Verification

- `cargo test workspace_index_schema_version_service_tests --manifest-path src-tauri/Cargo.toml`
- `cargo test workspace_index_schema_service_tests --manifest-path src-tauri/Cargo.toml`

## Next Slice

The next schema slice should introduce a small migration-policy read model:
compare expected domain versions with persisted versions and produce explicit
actions such as `compatible`, `needs-rebuild`, or `missing-version`.
