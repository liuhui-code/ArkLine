# ArkLine Bottom Tool Window Resize and Close Design

## Context

The current bottom tool window hosts Problems, Terminal, Git, Git Trace, and Usages. It can be shown and hidden by shell state, but its height is fixed by CSS and the interaction model does not clearly separate hiding the bottom tool window from closing tool-specific resources such as terminal sessions.

This creates two visible problems:

- The user cannot resize the bottom tool window vertically, so Terminal and Git can become cramped.
- Closing behavior is ambiguous. Hiding the panel should not close a running terminal session, while closing a terminal tab should still close only that session.

The target behavior follows mainstream IDE patterns from JetBrains IDEs, VS Code, and Cursor: bottom tool windows are resizable, can be hidden without losing state, and expose separate close controls for panel visibility and tool-owned resources.

## Goals

- Allow the bottom tool window height to be adjusted by dragging a top resize handle.
- Keep bottom tool state when the panel is hidden and restored.
- Separate "hide bottom tool window" from "close terminal session".
- Make current-tab clicks, close button, and keyboard hiding predictable.
- Preserve Terminal, Git, Git Trace, Problems, and Usages behavior unless it is directly related to panel visibility or sizing.

## Non-Goals

- No redesign of Terminal session management beyond preserving the current session-tab close semantics.
- No new Git operations or Git staging workflows.
- No docking to left/right or floating tool windows in this slice.
- No persistent settings storage for the panel height in the first implementation. In-memory session persistence is enough.

## Proposed Interaction

The bottom tool window becomes a resizable IDE panel with two levels of closure:

- The bottom panel close button collapses the tool content area and preserves the bottom tool tab strip plus tool state.
- Terminal session tab close buttons continue to close individual terminal sessions.

The panel has a top resize handle. Dragging the handle upward increases height; dragging downward decreases it. Height is clamped to a minimum of `160px` and a maximum of `70vh`. The default height is `280px`. The last in-memory height is reused when the panel is reopened.

Double-clicking the resize handle toggles between the default height and the maximum height.

## Tab Behavior

Bottom tool tabs keep their current role as tool selectors, with one additional IDE-style toggle:

- Clicking an inactive tab selects that tool and shows the bottom tool window.
- Clicking the active tab while the bottom tool content is visible collapses the content area.
- Clicking the active tab while the content area is collapsed restores it.
- Opening Terminal from the top bar restores the Terminal tool with the last bottom panel height.
- Commands such as Git, Problems, Git Trace, and Usages restore the panel rather than resetting height.

`Shift+Escape` collapses the bottom tool content when focus is inside it. This matches the close button state transition and leaves the bottom tool tab strip available for restore.

## Panel Controls

The bottom tool window header should include:

- A thin drag handle at the top edge.
- A tab strip for Problems, Terminal, Git, Git Trace, and Usages.
- A compact icon-only close button on the right with `aria-label="Hide Bottom Tool Window"`.

The close button collapses the content area. It does not close terminal sessions, clear Git selections, clear Git Trace, or clear Usages. The tab strip remains visible so the user can reopen the active or another bottom tool directly.

## State Model

`AppShell` should own bottom content expansion and height:

- `bottomContentVisible: boolean`
- `activeBottomTool: BottomToolKey`
- `bottomToolHeight: number`

The implementation should introduce separate actions for:

- showing a tool
- toggling a tool tab
- collapsing the bottom tool content
- resizing the bottom tool window

This avoids overloading the current `showBottomTool()` behavior, which only opens and selects.

Suggested semantics:

- `showBottomTool(tool)` always expands content and selects the tool.
- `toggleBottomTool(tool)` collapses content when `tool` is already active and content is expanded; otherwise it expands content and selects.
- `hideBottomToolWindow()` collapses content without mutating `activeBottomTool` or tool-specific state.
- `resizeBottomToolWindow(height)` clamps and stores the in-memory height.

## Layout and Rendering

`BottomToolWindow` should accept height and event handlers from `AppShell`:

- `height`
- `onResizeHeight`
- `onClose`
- `onSelectTool`
- `onToggleTool`

CSS should make the bottom panel stable:

- The panel uses a fixed computed height when expanded and a compact chrome-only height when collapsed.
- Its content area uses `min-height: 0` and internal scrolling.
- Terminal and Git panels fill the available panel height.
- The rest of the app layout should not overflow the viewport when panel height changes.

The resize handle should be large enough to hit comfortably but visually restrained, around 6-8px tall.

## Terminal Behavior

Collapsing the bottom tool content must not close terminal sessions. Existing terminal session tabs remain the owner of per-session close behavior.

When the panel is resized or Terminal becomes visible again, the terminal viewport should receive a resize/fit signal so xterm can fit the new dimensions. The design can use the existing terminal viewport controller if it already exposes an appropriate resize path, or add a small prop such as `layoutNonce` to trigger fitting.

If the final terminal session is closed from its session tab, the bottom panel remains visible and Terminal shows its current empty/new session state.

## Git and Other Tool Behavior

Git should preserve selected file state while collapsed. Its diff viewer and changed-file list should scroll internally within the panel.

Git Trace and Usages should preserve their current results while collapsed. Problems should preserve the current problem list.

## Accessibility

- The resize handle should have `role="separator"`, `aria-orientation="horizontal"`, and an accessible label such as `Resize Bottom Tool Window`.
- The close button should have `aria-label="Hide Bottom Tool Window"`.
- Tabs should keep `role="tab"` and `aria-selected`.
- Keyboard hiding through `Shift+Escape` should remain available.

Keyboard resizing is not required in the first implementation, but the separator role should not block adding it later.

## Tests

Add focused frontend tests for:

- Dragging the resize handle changes the bottom panel height within clamp limits.
- Clicking the active bottom tab collapses the content area.
- Clicking the same tab again restores the panel and preserves active tool.
- The close button collapses the bottom content while preserving the bottom tab strip and Terminal session tabs.
- Terminal session tab close still closes only that session and does not collapse the bottom content.
- `Shift+Escape` collapses the bottom content using the same state path as the close button.

Existing Terminal, Git, and shell hotkey tests should continue to pass.

## Open Decisions

No open decisions remain for this slice. Height persistence is intentionally in-memory only for the first implementation.
