# Unified Quality Gate Phase 81

## Problem

ArkLine had the right checks, but they were scattered across memory, README
snippets, and CI steps. That made it easy to forget backend line-count checks,
Rust tests, build verification, or runtime performance gates while iterating on
indexing and large-project responsiveness.

## Decision

Add two root-level commands for routine and full local verification:

```bash
pnpm check:fast
pnpm check
```

`check:fast` is the daily pre-commit gate. It keeps feedback bounded while
still covering line count, semantic worker tests, focused frontend quality
tests, Rust tests, build, and runtime performance.

`check` is the full merge-ready gate. It intentionally runs the checks in this
order:

1. `pnpm check:line-count`
2. `pnpm test`
3. `pnpm test:rust`
4. `pnpm build`
5. `pnpm perf:runtime`

## Scope

- `test:rust` standardizes Rust backend tests behind pnpm.
- `test:frontend` exposes the full Vitest frontend suite directly.
- `test:frontend:quality` keeps a focused daily frontend gate for crash,
  line-count, package-script, and latency checks.
- `check:fast` becomes the default pre-commit quality gate for incremental
  architecture changes.
- `check` remains the full gate for merge-ready validation.
- Existing individual commands remain available for focused debugging.

## Verification

Run:

```bash
pnpm check:fast
pnpm check
```

This covers the 500-line guard, semantic worker tests, frontend tests, Rust
tests, TypeScript/Vite build, and runtime performance budget.
