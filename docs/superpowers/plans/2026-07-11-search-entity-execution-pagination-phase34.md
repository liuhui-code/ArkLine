# Search Entity Execution Pagination Phase 34

## Goal

Move Search Everywhere entity async source selection and paged append patching into the entity session helper.

## Scope

- Add entity query executor for readiness, indexed, legacy, and local sources.
- Add entity pagination append patch helper.
- Keep controller-owned UI side effects unchanged.
- Add focused helper tests.

## Non-goals

- Do not change pagination UI behavior.
- Do not change backend query command signatures.
- Do not move text pagination in this phase.

## Follow-up

Extract text pagination patching and shared pagination state helpers.

## Verification

- Run entity helper and search controller tests.
- Run production build.
- Run runtime responsiveness guard.
- Keep all touched code files below 500 lines.
