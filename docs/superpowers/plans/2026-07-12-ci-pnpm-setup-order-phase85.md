# CI pnpm Setup Order Phase 85

## Problem

The release workflow installed pnpm before enabling `actions/setup-node` pnpm
cache, but Windows CI configured Node cache before pnpm existed. That kind of
workflow drift makes CI harder to reason about and can break cache behavior.

## Decision

Windows CI now follows the same order as the release workflow:

1. `pnpm/action-setup@v4`
2. `actions/setup-node@v4` with `cache: pnpm`

## Guard

`tests/frontend/ci-workflow-gates.test.ts` verifies both workflows install pnpm
before configuring Node's pnpm cache.

## Verification

Run:

```bash
pnpm test:frontend:quality
pnpm check:fast
```
