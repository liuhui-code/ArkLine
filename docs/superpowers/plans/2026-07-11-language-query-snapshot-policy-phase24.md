# Language Query Snapshot Policy Hints Phase 24

## Goal

Make LanguageQuery diagnostics explain what runtime path a request should prefer when content snapshots grow large, without changing the request payload yet.

## Scope

- Add a stable policy field to recorded LanguageQuery snapshots.
- Map content size classes to conservative policy hints.
- Show the hint in the diagnostics center.
- Cover normal, large, and oversized classes with focused tests.

## Non-goals

- Do not truncate editor content in language service requests.
- Do not change completion, definition, usages, or code action behavior.
- Do not alter indexing scheduler priorities in this phase.

## Policy Mapping

- `normal`: full content request remains acceptable.
- `large`: prefer indexed answers where available and watch latency.
- `oversized`: prefer worker or indexed path before synchronous UI queries.

## Verification

- Run focused frontend tests for snapshot store and diagnostics center.
- Run runtime responsiveness guard.
- Run production build.
- Check touched code files stay under 500 lines.
