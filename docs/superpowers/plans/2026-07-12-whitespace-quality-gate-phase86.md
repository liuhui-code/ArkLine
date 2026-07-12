# Whitespace Quality Gate Phase 86

## Problem

`git diff --check` was still a manual pre-commit habit instead of part of the
shared quality gate. That left whitespace errors and conflict-marker style
problems outside `pnpm check:fast`.

## Decision

Add:

```bash
pnpm check:whitespace
```

which runs `git diff --check`.

Both `pnpm check:fast` and `pnpm check` now run the whitespace gate first.

## Guard

`tests/frontend/package-scripts.test.ts` verifies the whitespace gate exists and
is part of both quality gates.

## Verification

Run:

```bash
pnpm check:fast
```
