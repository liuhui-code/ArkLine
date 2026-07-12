# AppShell Action Refs Phase 74

## Goal

Move AppShell cross-controller action ref boilerplate into a focused hook so AppShell remains a thin composition root.

## Scope

- Add `useAppShellActionRefs` for completion, search, settings, Git, editor, workspace opening, and project opening action refs.
- Preserve safe default callbacks for startup ordering before controllers assign real actions.
- Keep ref identities stable across rerenders.
- Reduce AppShell line count while keeping user-visible behavior unchanged.

## Verification

- Hook test covers safe defaults and stable identity.
- Focused AppShell restore/search regression tests cover the highest-risk ref handoff paths.
- Build, runtime perf, diff whitespace, line count, and git status gates before commit.

## Notes

A broad AppShell test-name pattern pulled in many unrelated slow interaction tests and produced flaky failures after long runtime. This phase uses exact focused tests plus build and perf gates instead.

## Follow-Up

- Extract long AppShell render prop builders into typed local builder hooks.
- Keep AppShell under the 500-line gate.
- Avoid changing UI behavior while continuing structural cleanup.
