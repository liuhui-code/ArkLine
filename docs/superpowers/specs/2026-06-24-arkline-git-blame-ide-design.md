# ArkLine IDE-Style Git Blame Design

## Goal

Make Git Blame feel like an editor annotation layer instead of a bottom-panel-only feature. The user must be able to turn it on and off freely, keep useful attribution while editing unsaved files, inspect commits without losing editing flow, and open deeper Git Trace details only when needed.

## Product Principles

- Blame is a code-history lens, not a modal workflow.
- Current-line blame should be lightweight enough to stay visible during normal editing.
- Full-file blame should be explicit and reversible.
- Unsaved edits must not erase history for unchanged lines.
- Commit details should be available progressively: inline hint, hover/card, then bottom panel or diff.

## Industry Alignment

JetBrains IDEs treat blame as editor annotations that can be shown, hidden, configured, and queried from the gutter. Their model emphasizes annotation actions such as showing a commit, copying revision data, navigating previous revisions, and hiding annotations.

GitLens popularized a two-level model in VS Code: current-line blame for constant low-noise context, and full-file blame annotations when the user asks for them. It also uses hover details, status bar affordances, and quick actions rather than forcing a large panel for every lookup.

ArkLine should follow the shared pattern: low-noise by default, explicit full-file annotations, and deeper panels only for investigation.

## Target Interaction

### Current-Line Blame

ArkLine shows current-line blame as lightweight editor/status context when blame data is available:

```text
Jane Doe, 2d ago - Fix terminal resize behavior
```

This does not consume a permanent gutter column. It updates when the cursor moves. If the current line is unsaved, it shows `Uncommitted` or `Modified, originally Jane Doe`.

### Full-File Blame

The user can toggle full-file blame through:

- command palette action: `Toggle Git Blame`
- Git tool window action: `Blame Current File`
- editor gutter/context action
- status bar blame menu

When enabled, a fixed-width gutter appears beside the editor line numbers. It does not shift width after load. It remains open while editing until the user closes it.

### Closing

The user can close full-file blame through:

- the same toggle action
- `Close Blame` from the blame context menu
- `Escape` when blame focus/card is active
- status bar blame menu

Closing blame must not close bottom Git, terminal, or other tool windows.

### Dirty Buffer Behavior

Unsaved edits keep useful blame:

- unchanged mapped lines keep their committed attribution
- inserted lines show `Uncommitted`
- modified lines show `Modified` and retain original attribution as secondary context
- deleted lines do not appear as editor rows, but local diff can show them
- saving refreshes the blame snapshot

The old behavior where any dirty edit disables the entire blame view is removed.

### Hover and Click

Hovering a blame annotation shows a compact commit card:

- subject
- author
- date
- short hash
- source line when available
- actions: `Show Diff`, `Copy Hash`

Single click selects and highlights the blamed commit range. It does not automatically open the bottom panel.

Opening the bottom panel is explicit through `Show Diff`, `Show Commit`, double click, or keyboard activation.

### Context Menu

The blame gutter context menu should reserve the following structure:

```text
Show Commit
Show Diff
Copy Commit Hash
Close Blame
---
Annotate Previous Revision
Ignore Whitespace
Detect Moved Lines
Hide This Revision
```

MVP implements the first group. The second group is reserved for later.

### Bottom Git Trace

The bottom Git Trace panel becomes the deep investigation surface:

- commit summary
- actions
- changed file context
- structured diff preview
- selected blamed line highlighted where possible

It should no longer be the only place to view a line's commit.

## Data Model

Git blame state is modeled against the current editor buffer, not only the saved Git file.

```ts
type GitBlameAttribution = {
  bufferLine: number;
  sourceLine?: number;
  status: "committed" | "added" | "modified" | "unavailable";
  commit?: string;
  shortCommit?: string;
  author?: string;
  authoredAt?: string;
  relativeTime?: string;
  summary?: string;
  originalCommit?: string;
  originalAuthor?: string;
};
```

The backend still supplies committed-file blame and commit details. The frontend adds a mapping layer that compares the base saved text with the current editor text and projects blame onto current buffer lines.

## MVP Scope

The first implementation should deliver:

- full-file blame toggle
- current-line blame text
- dirty buffer mapping for added and modified lines
- fixed-width gutter annotations
- hover/card or focused popover with commit details and basic actions
- bottom Git Trace panel cleanup sufficient to distinguish summary/actions/diff
- tests for dirty mapping, toggle behavior, and click/hover interaction

## Deferred

- annotate previous revision
- ignore whitespace
- detect moved lines
- hide revision
- remote commit opening
- file heatmap
- full file history browser

## Acceptance Criteria

- Blame can be opened and closed without changing bottom panel state.
- Adding a line marks only that line as uncommitted; surrounding committed lines keep attribution.
- Modifying a line marks it as modified and retains original attribution.
- Current-line blame updates as selection changes.
- Clicking/hovering a committed blame row exposes commit details without forcing a bottom-panel switch.
- The user can explicitly open Git Trace for a selected commit.
- Saving a dirty file refreshes blame.
- Untracked and non-repository files show clear unavailable states.
