# Index Roadmap Status Phase 88

## Problem

`docs/indexing-system-roadmap.md` still described several foundations as missing
even though later phases had implemented them:

- scheduler and task state machine
- durable file fingerprints
- readiness-aware query facade
- persisted SDK/API symbols
- diagnostics, health, repair, and explain services

That made the roadmap misleading as an execution guide.

## Goal

Keep the roadmap useful for the next indexing phases by distinguishing completed
foundations from real remaining gaps.

## Implementation

- Updated the current status section to list implemented scheduler,
  fingerprint, facade, SDK/API, and diagnostics foundations.
- Rewrote affected gap sections so they keep only current missing work, such as
  search scaling, SDK signature depth, richer repair UX, and long-running
  telemetry.
- Added `tests/frontend/indexing-roadmap-status.test.ts` so the roadmap cannot
  regress to claiming those foundations are absent.
- Added the roadmap status test to `pnpm test:frontend:quality` and
  `docs/quality-gates.json`.

## Verification

```sh
./node_modules/.bin/vitest run tests/frontend/indexing-roadmap-status.test.ts
pnpm test:frontend:quality
pnpm check:fast
```
