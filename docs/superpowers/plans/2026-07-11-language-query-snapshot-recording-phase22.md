# Language Query Snapshot Recording Phase 22

## Goal

Record foreground language-query snapshot metadata from the active request paths without changing request payloads.

## Current State

- Language query snapshot metadata and a ring-buffer store exist.
- Completion, Definition, Usages, and Code Actions still do not write snapshot records.
- `AppShell.tsx` is close to 500 lines, so this phase avoids adding wiring there.

## Plan

1. Add a shared singleton snapshot store export.
2. Record completion, definition, usages, and code actions snapshots inside their controllers.
3. Keep request payloads unchanged by using `snapshot.request`.
4. Add focused tests proving records are written.
5. Run focused tests, build, perf, line-count checks, and commit.

## Acceptance

- All four foreground language request kinds write snapshot records.
- AppShell remains untouched.
- Touched code files remain below 500 lines.
