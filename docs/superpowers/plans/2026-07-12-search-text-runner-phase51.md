# Search Text Runner Phase 51

## Goal

Move global text search planning and request orchestration out of
`use-search-everywhere-controller.ts`.

## Scope

- Add `search-text-runner.ts` as the text-search orchestration boundary.
- Preserve indexed facade selection for clean plain text queries.
- Preserve live fallback for dirty documents, regex queries, and option-sensitive
  searches.
- Keep request tracking, latency recording, preview scheduling, and miss reporting
  delegated to the existing request runner.
- Keep every code file under 500 lines.

## Behavior Guarantees

- No workspace root means no text query is started.
- Dirty documents never use potentially stale indexed text results.
- Indexed readiness still updates shared query readiness.
- Indexed candidates are converted into workspace text search matches with the
  correct root path.

## Follow-Up

The remaining controller work is mostly effect lifecycle and read/preview wiring.
The next phase should extract the active-overlay query effect into a small
dispatcher so UI hook state remains separate from query startup policy.
