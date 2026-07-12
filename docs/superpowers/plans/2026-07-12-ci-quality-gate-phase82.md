# CI Quality Gate Phase 82

## Problem

The repository had a reusable fast quality gate, but Windows CI still duplicated
individual commands and used a pnpm version that did not match `packageManager`.
That made local and CI verification drift possible.

## Decision

Windows CI now runs:

```bash
pnpm check:fast
```

before packaging. The workflow also uses pnpm `10.12.1`, matching
`package.json`.

## Guard

`tests/frontend/ci-workflow-gates.test.ts` checks that Windows CI:

- uses pnpm `10.12.1`
- runs `pnpm check:fast`
- no longer duplicates `pnpm test`, direct `cargo test`, or `pnpm perf:runtime`

The CI workflow test is included in `test:frontend:quality`, so
`pnpm check:fast` protects its own CI integration contract.

## Verification

Run:

```bash
pnpm check:fast
```
