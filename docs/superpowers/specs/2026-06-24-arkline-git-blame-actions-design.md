# ArkLine Git Blame Actions Design

## Goal

Complete the day-to-day Git Blame interaction loop after the IDE-style blame MVP. Users should be able to discover, open, refresh, inspect, copy, and close blame from normal IDE entry points without losing editor focus or accidentally changing bottom tool windows.

## Scope

This phase implements the operation layer around the existing blame model:

- command palette entries
- status bar blame menu
- richer blame card actions
- predictable Escape behavior
- save-triggered blame refresh
- local-diff handling for uncommitted blame rows

It does not implement annotate previous revision, file history, line history, heatmap, moved-line detection, remote commit opening, or whitespace-ignore blame.

## Product Model

Blame now has three interaction surfaces:

1. **Status Bar**
   - Always low-noise.
   - Shows current-line blame and `Blame On/Off`.
   - Clicking the blame toggle opens a small menu, not only a binary toggle.

2. **Command Palette**
   - Keyboard-first entry point.
   - Lets users invoke blame actions even when the status bar is not visually scanned.

3. **Blame Card**
   - Focused details for the selected line.
   - Does not switch bottom tools unless the user explicitly chooses a deeper action.

## Status Bar Menu

Clicking the status bar blame control opens an anchored menu with:

```text
Toggle Git Blame
Refresh Blame
Show Current Line Commit
Close Blame
```

Behavior:

- `Toggle Git Blame` opens/closes the full-file blame gutter.
- `Refresh Blame` reloads raw Git blame for the active saved file and remaps onto the current buffer.
- `Show Current Line Commit` opens the blame card for the current editor line when attribution exists.
- `Close Blame` closes the gutter and any blame card.

The menu closes on outside click, Escape, item activation, active file switch, or overlay opening.

## Command Palette

Add these command palette entries:

```text
Toggle Git Blame
Refresh Git Blame
Show Current Line Git Blame
Close Git Blame
```

Command behavior mirrors the status bar menu. Commands should be available only when an active file exists. If blame is unavailable, commands should set a clear status message instead of throwing.

## Blame Card Actions

For committed rows, the blame card shows:

- `Show Commit`
- `Show Diff`
- `Copy Hash`
- `Close`

For local rows (`added` or `modified`), the blame card shows:

- `Show Local Diff`
- `Close`

Behavior:

- `Show Commit` opens Git Trace focused on the selected commit.
- `Show Diff` opens the current commit diff flow.
- `Copy Hash` copies the full commit hash and updates the status bar.
- `Show Local Diff` opens the Git tool window with the current workspace diff.
- `Close` closes only the card.

Disabled actions should be hidden when they do not apply, not shown as dead controls, except `Copy Hash` may be disabled if the clipboard API is unavailable.

## Escape Behavior

Escape should close the most local blame surface first:

1. if blame status menu is open, close it
2. else if blame card is open, close it
3. else if full-file blame gutter has focus, close full-file blame
4. else fall through to existing transient UI handling

This must not break:

- completion overlay Escape behavior
- Search Everywhere Escape behavior
- settings modal Escape behavior
- bottom tool window hide behavior

## Save-Triggered Refresh

After saving the active file:

1. document baseline updates
2. raw Git blame is reloaded for the saved file
3. current buffer attribution is recomputed
4. current-line blame and full-file blame update without flicker
5. status bar briefly reports `Blame refreshed`

If refresh fails:

- keep the previous attribution visible if it still maps cleanly
- show `Blame refresh failed: <reason>` in the status bar
- do not block save completion

## State Model

Extend shell-level blame UI state:

```ts
type GitBlameMenuState = {
  open: boolean;
};

type GitBlameUiState = {
  fullFileVisible: boolean;
  selectedAttribution: GitBlameAttribution | null;
  menuOpen: boolean;
  refreshToken: number;
};
```

The refresh token is passed into `useGitTrace` so explicit refresh and save-triggered refresh can reload raw blame without coupling to dirty-buffer remapping.

## Implementation Boundaries

- `use-git-trace.ts`
  - accepts `refreshToken`
  - reloads raw blame when token changes
  - continues remapping active buffer text without re-running Git blame on every keystroke

- `ShellStatusBar.tsx`
  - renders the blame control and status menu
  - does not own Git data

- `AppShell.tsx`
  - owns UI state and action handlers
  - wires command palette actions
  - coordinates save-triggered refresh

- `GitBlameCard.tsx`
  - renders committed vs local actions
  - stays presentational

## Acceptance Criteria

- Command palette can toggle, refresh, show, and close blame.
- Status bar menu exposes the same core actions.
- Clicking `Show Current Line Commit` opens the card without switching bottom tools.
- Committed blame card supports show commit, show diff, copy hash, and close.
- Local blame card supports show local diff and close.
- Escape closes menu/card before existing broader transient UI behavior.
- Saving an active file refreshes blame once and does not block save when refresh fails.
- Keystrokes do not repeatedly invoke `getFileBlame`.
- Existing completion, Search Everywhere, settings, terminal, and Git Trace tests remain stable.
