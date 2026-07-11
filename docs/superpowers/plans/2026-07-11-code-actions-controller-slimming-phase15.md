# Code Actions Controller Slimming Phase 15

## Goal

Keep the Code Actions controller below the 500-line limit and prepare a clean boundary for later content-budget and worker-backed Code Actions.

## Current State

- `use-code-actions-workspace-edit-controller.ts` is close to 500 lines.
- It owns orchestration, request construction, source filtering, and display copy.
- Later performance work needs a stable place to add content snapshot policy without bloating the hook.

## Plan

1. Add a focused Code Actions request model.
2. Move source labels, empty messages, request construction, and action filtering into the model.
3. Update the controller to call the model while preserving behavior.
4. Add focused model tests.
5. Run tests, build, perf, line-count checks, and commit.

## Acceptance

- Controller drops comfortably below 500 lines.
- Existing Code Actions behavior and messages remain compatible.
- New model is small, typed, and independently testable.
