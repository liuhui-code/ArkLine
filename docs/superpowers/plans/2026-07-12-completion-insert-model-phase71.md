# Completion Insert Model Phase 71

## Goal

Move completion acceptance calculations out of `use-completion-controller.ts` so
the controller can continue shrinking toward a request/session coordinator.

## Scope

- Extract snippet placeholder normalization for accepted completion items.
- Extract replacement length calculation.
- Preserve `replacementRange` precedence.
- Preserve fallback to the current editor prefix or completion prefix.
- Keep completion request, ranking, popup, and keyboard behavior unchanged.
- Keep all touched code files below 500 lines.

## Verification

- Add model tests for snippet insertion and range fallback.
- Run completion model, controller, and candidate provider tests.
- Run production build and runtime responsiveness guard before commit.

## Follow-up

Next completion slices should move request lifecycle and empty/error application
into dedicated action modules, leaving the hook mostly as wiring.
