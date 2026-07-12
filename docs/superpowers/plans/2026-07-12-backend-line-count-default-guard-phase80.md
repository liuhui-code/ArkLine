# Backend Line Count Default Guard Phase 80

## Goal

Make the 500-line maintenance ceiling apply to backend Rust code by default, not only through manual `--roots=` checks.

## Completed

- Added `src-tauri/src` to `scripts/check-line-count.mjs` default roots.
- Added a regression test proving backend Rust files are collected by default.
- Re-ran the default line-count check against 577 code files.

## Verification

- Red check before implementation:
  - `./node_modules/.bin/vitest run tests/frontend/check-line-count.test.mjs`
- Passing checks:
  - `./node_modules/.bin/vitest run tests/frontend/check-line-count.test.mjs`
  - `pnpm check:line-count`
  - `node scripts/check-line-count.mjs --limit=500 --roots=src,semantic-worker/src,scripts,src-tauri/src`

## Maintenance Note

Future backend modules now fail `pnpm check:line-count` if they exceed 500 lines, so no separate manual backend line-count command is needed for routine verification.
