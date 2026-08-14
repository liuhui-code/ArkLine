# IDEA-style Git workflow

Date: 2026-08-14  
Branch: `feat/idea-git-workflow`

## Outcome

ArkLine adopts the JetBrains interaction model for everyday Git work while retaining ArkLine's visual tokens:

- `Ctrl/Cmd+K`: open the left Commit tool window and focus the commit message.
- `Ctrl/Cmd+Shift+K`: open a modal Push Commits preview.
- `Alt+9`: open the bottom Git Log.
- Selecting a changed file opens a reusable central editor Diff Preview.
- Multi-root workspaces expose an explicit repository selector.

This separates three different user intents: preparing a local commit, reviewing outgoing commits, and browsing repository history.

## Commit tool window

The left dock is a changelist-style composer rather than a staging UI. Tracked files are included by default, unversioned files are excluded, and conflicts cannot be selected. Group checkboxes allow fast bulk selection. The implementation synchronizes the selected set to the Git index immediately before commit, so the UI remains simple while the repository operation stays Git-compatible.

The composer is fixed below the scrollable change list. It supports Commit, Commit and Push, Amend, and Sign-off. A partial status page blocks commit until all pages are loaded, preventing an incomplete selection from being mistaken for the full working tree.

Terminology follows IDEA:

- Rollback Changes: restore tracked working-tree edits.
- Delete Unversioned File: remove an untracked file.
- Revert Commit: create a new inverse commit from Git Log.

Rollback retains ArkLine's protected backup and Undo affordance.

## Diff preview

Local and historical diffs use the central editor area. The preview contains a file navigator and the existing side-by-side, unified, full-file, hunk, and line-selection review modes. Opening a source file closes the preview and returns to the normal editor without replacing editor tabs.

Commit-view diffs compare `HEAD` with the working tree. This deliberately includes both indexed and non-indexed edits for a file, matching the checkbox abstraction shown to the user.

## Push Commits

The Push dialog resolves the checked-out branch, its upstream, and `upstream..HEAD`. It previews the complete outgoing chain, loads selected commit details lazily, and never presents arbitrary per-commit omission because Git pushes a reachable ref, not isolated list rows.

For a new branch, Push publishes it and sets the upstream. A non-fast-forward rejection keeps the dialog open and offers:

- Update with Rebase, then retry Push.
- Update with Merge, then retry Push.
- Force Push with Lease, behind a second confirmation.

Working-tree updates first guard unsaved editor documents and reconcile open files afterward. Raw `--force` is never exposed.

## Git Log

The bottom Git tool window owns Log, Stashes, and Line Trace. Log is keyboard navigable, paginated, and filterable by local or remote branch. Commit details retain changed-file browsing, Open Diff, Cherry-pick, Revert, and Copy Hash.

## Multi-root behavior

Root discovery is bounded to 20,000 directories, does not follow directory symlinks, and skips generated dependency/build directories. Selecting another repository resets root-scoped controllers, cancels obsolete queries, and refreshes Commit, Push, branches, and Log for that root.

## Safety and performance invariants

- Repository reads use cancellable query IDs, timeouts, pagination, and output limits.
- Mutations are serialized by the existing repository runtime.
- Commit selection refuses partial snapshots and unresolved conflicts.
- Pull recovery protects dirty editor buffers and reconciles external changes.
- Force updates use `--force-with-lease` only.
- Root discovery and filesystem traversal are bounded.
- New source files remain under 500 lines; the project line-count gate enforces this.

## Industry references

- JetBrains IntelliJ IDEA, Commit and push changes: https://www.jetbrains.com/help/idea/commit-and-push-changes.html
- JetBrains IntelliJ IDEA, Log tab: https://www.jetbrains.com/help/idea/log-tab.html
- Visual Studio Code, source control repositories and remotes: https://code.visualstudio.com/docs/sourcecontrol/repos-remotes

The JetBrains model is the primary UX reference. VS Code's repository/remote handling is used as a cross-check for multi-repository discoverability and explicit synchronization state.

## Verification contract

- Shortcut mapping tests cover Commit and Push Commits on Ctrl/Cmd.
- Component tests cover defaults, group selection, central Diff Preview, Commit and Push, rollback/undo, pagination, multi-root switching, outgoing preview, and rejection recovery.
- Rust tests cover repository diffs, history, remotes, and bounded root discovery.
- TypeScript compilation, production build, Rust formatting, diff checks, and the 500-line gate must pass before handoff.
