# Language Query Snapshot Diagnostics Phase 23

## Goal

Expose recent foreground language-query snapshot metadata in the Index Diagnostics Center.

## Current State

- Completion, Definition, Find Usages, and Code Actions record snapshot metadata.
- The metadata is not visible to users or developers yet.
- `IndexDiagnosticsCenter.tsx` is close to 500 lines, so the UI must live in a small child component.

## Plan

1. Add a `LanguageQuerySnapshotPanel` child component.
2. Read the snapshot store when the diagnostics center renders.
3. Show kind, file location, content class, and content size.
4. Add focused diagnostics UI coverage.
5. Run tests, build, perf, line-count checks, and commit.

## Acceptance

- Diagnostics center shows recent language-query snapshots.
- AppShell remains untouched.
- Touched code files remain below 500 lines.
