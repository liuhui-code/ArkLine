# Active Workspace Session Persistence Phase 73

## Goal

Move last-active-file session persistence out of AppShell and protect workspace restore from session overwrite timing.

## Scope

- Extract active workspace session persistence into a focused hook.
- Keep session persistence disabled until settings hydration completes.
- Skip duplicate settings writes when the active file is unchanged.
- Capture the restore target before applying a workspace snapshot.
- Use a restore-specific editor open path so startup restore can report unavailable files without changing normal navigation semantics.
- Keep AppShell as orchestration and keep touched code files under 500 lines.

## Verification

- Hook coverage for hydration guard, persistence, and duplicate write suppression.
- AppShell coverage for recent project restore, launch workspace preference, unavailable last file, and recent project reopen.
- Build, runtime perf, diff whitespace, line count, and git status gates before commit.

## Follow-Up

- Continue extracting AppShell orchestration effects.
- Move command payload builders out of AppShell.
- Keep restore, search, and navigation flows observable during large-project startup.
