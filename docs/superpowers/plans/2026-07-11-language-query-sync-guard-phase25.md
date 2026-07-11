# Language Query Sync Guard Phase 25

## Goal

Add a shared guard model that explains whether a LanguageQuery snapshot is acceptable for synchronous UI-thread language requests.

## Scope

- Create a pure guard function from existing snapshot metadata.
- Preserve current completion, definition, usages, and code action behavior.
- Record the guard decision with existing LanguageQuery snapshots.
- Surface the decision in diagnostics.

## Non-goals

- Do not truncate editor content.
- Do not skip language service calls yet.
- Do not change query ordering or index scheduler priorities in this phase.

## Guard Rules

- `normal`: synchronous request is allowed.
- `large`: synchronous request is allowed but should prefer indexed results where available.
- `oversized`: synchronous UI-thread request should be avoided; worker or indexed path should be preferred.

## Verification

- Add focused model/store tests.
- Run diagnostics tests.
- Run runtime performance guard.
- Run production build.
- Keep touched code files below 500 lines.
