# Release Quality Gate Phase 83

## Problem

The Windows CI workflow used `pnpm check:fast`, but the manual release workflow
that builds `ArkLine-windows-x64.exe` went straight from dependency install to
packaging. That could publish a downloadable executable without the same local
and CI quality evidence.

## Decision

`macos-windows-exe.yml` now runs:

```bash
pnpm check:fast
```

after installing dependencies and before `pnpm package:windows:portable`.

## Guard

`tests/frontend/ci-workflow-gates.test.ts` now verifies that the release workflow:

- uses pnpm `10.12.1`
- runs `pnpm check:fast`
- runs the gate after dependency install
- only packages the portable exe after the gate

## Verification

Run:

```bash
pnpm test:frontend:quality
pnpm check:fast
```
