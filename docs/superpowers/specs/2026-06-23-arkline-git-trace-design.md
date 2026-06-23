# ArkLine Git Trace Design

Last updated: 2026-06-23

## Goal

Bring ArkLine's Git experience closer to IDEA for code reading by adding a
focused line-level trace workflow.

This phase is not a general Git client upgrade. It adds one coherent reading
loop:

1. see who last changed each visible line
2. select a line to inspect its commit
3. review the commit summary and file-scoped patch
4. jump from the trace panel back into source or a commit diff

The intent is to make code provenance easy to inspect while preserving
ArkLine's editor-first, lightweight-review positioning.

## Scope

### In scope

- line-level Git blame for the active saved file
- blame summaries rendered beside code in the editor surface
- click-through from a blamed line into a new bottom `Git Trace` tool window
- commit metadata for the selected line:
  - short hash
  - author
  - authored time
  - subject
- file-scoped patch preview for the selected commit
- graceful fallback states for unsupported files and unavailable Git
- one frontend API contract that can use mock/demo or Tauri-backed Git data

### Out of scope

- staging, unstaging, partial staging, shelving, or changelists
- branch graph, commit graph, or repository log browser
- file history tree
- block history
- inline commit-diff editor tabs
- uncommitted local-line provenance
- multi-repository management

This phase is line trace only. It intentionally stops before broader Git
workflow features.

## User Experience

### Happy path

The user opens a file that is tracked by Git and already saved on disk.

- ArkLine loads blame data for the active file
- each visible line shows a compact blame label in a dedicated left-side trace
  column
- the label format is:
  - author short name
  - relative time
  - shortened subject
- clicking a blame label:
  - keeps the editor in context
  - marks the selected source line
  - opens the bottom `Git Trace` tool window
  - loads commit details for that line

The `Git Trace` tool window then shows:

- `Commit Summary`
  - short hash
  - author name and email if available
  - authored time
  - subject
- `Line Context`
  - relative file path
  - selected working-tree line number
  - blamed source line number if Git returns one
- `Patch Preview`
  - the selected commit's patch for the current file

The panel exposes two actions:

- `Open in Editor`
- `Open Commit Diff`

`Open Commit Diff` is allowed to reuse the existing bottom Git diff viewer path
for the first version. It does not need a new full-screen commit browser.

### Blame density

To stay readable, blame labels must be intentionally weak visual chrome:

- smaller and dimmer than source text
- single-line, ellipsized
- no wrapping
- no decorative badges or pills

This mirrors IDEA's philosophy: provenance stays near code but never competes
with it.

### Selection behavior

Blame selection follows source-line selection, not separate row focus.

- clicking a blame label selects its source line
- changing the active editor file clears the previous trace selection
- reloading blame for the current file preserves the selected line when possible

### Unsupported and degraded states

ArkLine must not guess or fabricate blame.

Required states:

- file is outside a Git repo:
  - `Not a Git-tracked file`
- file exists in repo but is untracked:
  - `File is not tracked by Git`
- file has unsaved edits:
  - `Save file to refresh line history`
- Git executable unavailable:
  - `Git unavailable`
- commit details fail after blame succeeds:
  - keep blame visible
  - show `Commit details unavailable` in the `Git Trace` panel

These states must be explicit in both the editor trace column and the bottom
panel so the user knows whether the limitation is repository state, save state,
or runtime environment.

## UI Placement

### Editor surface

Line trace belongs inside the editor surface because the user is reading code,
not browsing repository history.

The editor gets a dedicated blame presentation area to the left of line numbers
or in a parallel gutter-style column. First version requirements:

- source line numbers remain intact
- blame labels align line-for-line with visible code
- blame rendering scrolls with the editor
- blame labels are clickable
- blame labels do not intercept normal text selection inside the code body

The editor must remain usable even when blame is unavailable. This is an
augmentation, not a new required mode.

### Bottom tool window

A new bottom tab is added:

- `Git Trace`

This tab sits beside:

- `Problems`
- `Terminal`
- `Git`
- `Usages`

It is separate from the existing `Git` tab because the two jobs differ:

- `Git` shows current working-tree changes
- `Git Trace` explains historical provenance for a selected line

Combining them would blur two different reading tasks and make long-term
maintenance harder.

## Architecture

The feature is split into four layers.

### 1. Git trace API layer

`workspace-api` becomes the single frontend boundary.

Required methods:

```ts
type GitBlameLine = {
  line: number;
  commit: string;
  sourceLine: number;
  author: string;
  authoredAt: string;
  summary: string;
};

type GitCommitTrace = {
  commit: string;
  shortCommit: string;
  author: string;
  email?: string;
  authoredAt: string;
  subject: string;
  relativePath: string;
  selectedLine: number;
  sourceLine: number;
  patch: string;
};
```

```ts
getFileBlame(path: string): Promise<GitBlameLine[] | GitTraceUnavailable>;
getCommitTrace(path: string, commit: string, line: number): Promise<GitCommitTrace | GitTraceUnavailable>;
```

`GitTraceUnavailable` is a typed fallback result, not a thrown stringly error.
That keeps UI handling deterministic.

### 2. Shell state layer

Git trace state must stay separate from:

- existing diff review state
- terminal state
- usage search state

Suggested state:

```ts
type GitTraceState = {
  blameStatus: "idle" | "loading" | "ready" | "unavailable" | "error";
  blameLines: GitBlameLine[];
  selectedLine: number | null;
  selectedCommit: string | null;
  detailStatus: "idle" | "loading" | "ready" | "unavailable" | "error";
  detail: GitCommitTrace | null;
  message?: string;
};
```

This state should live in focused shell/helper code, not as additional
loosely-related booleans in `AppShell`.

### 3. Editor integration layer

The editor must gain one additional optional rendering channel:

- blame decorations / blame gutter markers

This layer is responsible for:

- mapping blame data to visible lines
- showing selected blame row state
- dispatching line-click events back to the shell

This layer is not responsible for:

- calling Git
- parsing blame porcelain
- storing commit detail state

### 4. Trace presentation layer

A dedicated `GitTracePanel` component presents the bottom-panel detail.

Responsibilities:

- render loading / unavailable / error / ready states
- render commit summary
- render line context
- render patch preview
- expose actions back to shell callbacks

Non-responsibilities:

- no Git command execution
- no editor decoration logic

## Backend Strategy

### First version

Use the Git CLI through Tauri/Rust.

Commands:

- `git blame --line-porcelain -- <file>`
- `git show <commit> -- <file>`

Why this is the right first move:

- stable on macOS and Windows
- no custom repository engine to debug
- matches ArkLine's lightweight runtime philosophy
- easy to validate manually outside the app

### Future compatibility

The frontend API must not assume CLI-specific output fields. The Rust service is
the translation boundary. That lets ArkLine later move to:

- `libgit2`
- cached blame snapshots
- background file-history indexing

without rewriting the editor or panel UI.

## Performance and Memory

First version performance rules:

- only load blame for the active file
- only refresh blame when:
  - active file changes
  - saved content changes
  - user explicitly requests refresh
- do not preload repository-wide history
- do not retain commit patch blobs for multiple files at once

This keeps memory bounded and preserves ArkLine's requirement for a light
runtime.

The bottom panel may cache only the currently selected commit detail for the
active file. Anything broader is unnecessary for the first phase.

## File and Module Plan

To keep maintainability aligned with ArkLine's small-file rule, the work should
be split roughly as follows:

- `src/features/git/git-trace-model.ts`
  - shared types and pure UI-state helpers
- `src/components/layout/GitTracePanel.tsx`
  - bottom-panel rendering
- `src/editor/git-trace-decorations.ts`
  - blame decoration / click mapping
- `src-tauri/src/services/git_trace_service.rs`
  - Git CLI orchestration and parsing
- `src-tauri/src/commands/git_trace.rs`
  - Tauri command layer

Existing files should only gain narrow integration points:

- `workspace-api.ts`
- `AppShell.tsx`
- editor extension wiring
- bottom tool-window tab registration

No single new file should need to exceed the existing project guardrail.

## Error Handling

The UI must distinguish:

- unavailable capability
- repository state limitation
- execution failure

Examples:

- capability unavailable:
  - `Git unavailable`
- repo state limitation:
  - `File is not tracked by Git`
- execution failure:
  - `Failed to load line history`

Execution failures should be short in the status bar and slightly more explicit
inside the panel. The bottom panel is the right place for actionable detail.

## Testing

### Frontend

Add focused tests for:

- blame unavailable state rendering
- selecting a blame line opens `Git Trace`
- trace panel shows commit summary and patch preview
- switching active files refreshes blame state
- unsaved-file fallback message

### Backend

Add focused Rust tests for:

- parsing `git blame --line-porcelain`
- mapping blame entries to line models
- extracting commit summary and patch text from `git show`
- unavailable / untracked / non-repo handling

### Integration confidence

Manual verification checklist:

1. open a tracked file
2. confirm blame labels render
3. click a blamed line
4. confirm `Git Trace` opens
5. confirm commit metadata matches terminal Git output
6. confirm patch preview is file-scoped
7. edit file without saving and confirm fallback message

## Rollout Order

Recommended implementation order:

1. backend Git trace service and workspace API contract
2. shell state and bottom `Git Trace` panel
3. editor blame rendering
4. line click-through and panel synchronization
5. degraded-state handling and tests

This order keeps the logic testable before the editor integration lands.

## Future Extensions

This design intentionally leaves clean upgrade paths for:

- file history
- block history
- per-line hover popup
- commit navigation from trace panel
- merge-aware blame options

Those should build on the same API and panel structure rather than replace it.
