# Budgeted Language Query Snapshot Phase 27

## Goal

Avoid copying and forwarding full editor content for oversized LanguageQuery requests when the active document can provide length and slice readers.

## Scope

- Add an 80k character LanguageQuery request content budget.
- Preserve original document length in snapshot metadata.
- Mark snapshots with `contentBudgetExceeded`.
- Keep legacy callers compatible with `getActiveContent()`.
- Wire AppShell language controllers to active document length and slice readers.

## Non-goals

- Do not build cursor-centered content windows yet.
- Do not change code action request behavior in this phase.
- Do not remove existing oversized sync guards.

## Follow-up

Move AppShell active content reader wiring into a small hook before adding more controller consumers, because AppShell is now close to the 500-line limit.

## Verification

- Run LanguageQuery model and controller tests.
- Run runtime responsiveness guard.
- Run production build.
- Keep all touched code files below 500 lines.
