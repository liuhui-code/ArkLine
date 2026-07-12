# Quality Gate Manifest Phase 87

## Problem

The repository had converged on shared quality gate scripts, but the contract
still lived as repeated strings across package scripts, CI checks, README tests,
and phase documents.

That made future changes easy to drift:

- `package.json` could add or remove one gate step without documentation.
- CI and release workflows could keep using the right script while the expected
  composition became unclear.
- Focused frontend quality tests could be edited without a single readable list.

## Goal

Add a small machine-readable quality gate manifest that records the intended
fast gate, full gate, and focused frontend test set.

## Implementation

`docs/quality-gates.json` is the source of the quality gate contract:

- `pnpm check:fast`
- `pnpm check`
- focused frontend quality tests included by `pnpm test:frontend:quality`

`tests/frontend/quality-gate-manifest.test.ts` checks that the manifest matches
the actual package scripts.

`pnpm test:frontend:quality` now includes the manifest test, so the contract is
validated by the same fast gate used locally, in Windows CI, and before release
packaging.

## Verification

```sh
./node_modules/.bin/vitest run tests/frontend/quality-gate-manifest.test.ts tests/frontend/package-scripts.test.ts
pnpm test:frontend:quality
pnpm check:fast
```
