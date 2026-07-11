# Runtime Boundary Active Document Phase 28

## Goal

Move active document content access out of `AppShell` and behind a small runtime adapter.

## Scope

- Create `active-document-runtime` with content, length, and slice readers.
- Keep completion, definition, and usages on the same reader interface.
- Reduce `AppShell` pressure without changing UI behavior.
- Add focused adapter tests.

## Non-goals

- Do not change search controller structure in this phase.
- Do not replace full document storage with change sets yet.
- Do not change editor rendering behavior.

## Follow-up

Split `use-search-everywhere-controller` into input, query, preview, and navigation session modules.

## Verification

- Run adapter and LanguageQuery controller tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
