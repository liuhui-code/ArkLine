# README Quality Gate Phase 84

## Problem

The package scripts and CI workflows had converged on `pnpm check:fast`, but
README still documented separate `pnpm test`, direct `cargo test`, and
`pnpm build` commands as the default verification path.

## Decision

README now documents `pnpm check:fast` as the default local verification gate.
`pnpm check` remains the full merge-ready gate when the full frontend suite is
needed.

## Guard

`tests/frontend/readme-quality-gates.test.ts` verifies that README:

- documents `pnpm check:fast` in the macOS verification section
- documents `pnpm check:fast` in the Development section
- does not keep the old three-command sequence as the default Development gate

The README gate is included in `test:frontend:quality`, so future changes that
drift README away from the real quality gate are caught by `pnpm check:fast`.

## Verification

Run:

```bash
pnpm test:frontend:quality
pnpm check:fast
```
