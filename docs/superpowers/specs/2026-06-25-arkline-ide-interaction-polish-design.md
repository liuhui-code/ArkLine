# ArkLine IDE Interaction Polish Design

Date: 2026-06-25

## Scope

This design covers four focused IDE interaction fixes:

1. Git blame must release its editor gutter space when turned off.
2. The left navigation/tool-window area must be horizontally resizable.
3. Code completion must hide when the caret moves to another line, then reappear when the caret returns to its original compatible line.
4. `Ctrl+F7` must open a searchable popup listing methods in the current class or component, with jump-to-method behavior.

The goal is predictable IDE behavior aligned with JetBrains, VS Code, and Cursor conventions: layout state should be stable, transient UI should not linger in the wrong context, and keyboard navigation should stay first-class.

## Design

### Git Blame Space Release

Git blame is currently disabled visually by passing an empty attribution list to the CodeMirror gutter extension. That leaves the gutter extension installed, so CodeMirror can still reserve horizontal space.

When blame is off, ArkLine should reconfigure `gitTraceCompartment` to an empty extension array. When blame is on, it should install `createGitTraceGutter(...)`. This makes the editor layout physically reclaim the blame lane instead of only hiding labels.

Closing blame also clears the selected blame card and menu state. Existing status-bar blame controls remain the entry point.

### Resizable Left Navigation

The left side consists of a fixed rail and the project/tool pane. The rail remains fixed; the pane becomes resizable with an IDE-style vertical separator between the sidebar and editor.

Behavior:

- Default pane width: about `300px`.
- Minimum width: about `220px`.
- Maximum width: about `520px` or a viewport-aware clamp, whichever is smaller.
- Dragging the separator resizes the visible project pane.
- Keyboard support on the separator uses left/right arrows with larger steps on Shift.
- Hiding the project pane still collapses the pane area; reopening restores the last width.

The implementation stores width in `AppShell` local state. Persisting layout profiles is outside this scope.

### Completion Line Suspension

Completion should be anchored to the line where it was requested. When completion opens, ArkLine records a small session:

- active path
- origin line
- origin column
- trigger type
- replacement prefix
- cached completion items

On selection changes:

- If the caret moves to a different line, the completion popup hides without clearing the cached session.
- If the caret returns to the same line and the current prefix is still compatible with the original replacement prefix/query, the popup reappears.
- If the user accepts, cancels with Escape, edits into an incompatible prefix, changes file, or opens another overlay, the session is cleared.

This matches the expected feel of modern IDE completion: suggestions are contextual to a line and should not float over unrelated code, but they should recover when the user briefly navigates away and returns.

### Ctrl+F7 Current Class Methods

`Ctrl+F7` opens a modal palette titled "Methods in Current Class". It lists methods from the class, struct, or component enclosing the current caret.

Behavior:

- The palette is centered/top-weighted like command palette/search.
- The search input receives focus.
- Typing filters by method name and signature.
- Arrow keys move selection.
- Enter or click jumps to the selected method line and closes the popup.
- Escape closes without moving the caret.
- Empty state says no methods are found for the current class/component.

Initial symbol extraction should be local and deterministic:

- Find the nearest enclosing `struct`, `class`, or component-like block around the current line.
- Parse method declarations inside that block such as `build()`, `aboutToAppear()`, `onPageShow()`, `private helper(arg)`, and async methods.
- Exclude nested callback expressions and chained ArkUI calls.

Semantic-worker document symbols are outside this scope. The first implementation works offline against current editor content.

## Components And Boundaries

- `ArkTsEditor` and `editor-extensions`: own CodeMirror extension installation and gutter reconfiguration.
- `AppShell`: owns pane width, completion session state, method popup state, and command dispatch.
- `ShellSidebar`: accepts width and resize callbacks, renders the separator.
- New method-symbol helper: parses current document content into current-class method entries; unit tested independently.
- New method popup component or reuse of palette primitives: renders query, results, and actions without affecting quick open/search/completion behavior.
- `shell-keymap`: adds `showCurrentClassMethods` bound to `Ctrl+F7`.

## Testing

Use test-first coverage for each behavior:

- Git blame off reconfigures the editor without a blame gutter.
- Left sidebar drag and keyboard resize update width and clamp to min/max.
- Completion hides on another line and reappears when returning to the origin line with a compatible prefix.
- `Ctrl+F7` opens method popup, filters methods, and jumps to the selected method.
- Keymap inventory includes `Ctrl+F7` without breaking existing `Alt+F7` Find Usages.

Run focused frontend tests first, then the full frontend test suite. If editor-level DOM behavior is hard to assert through JSDOM, cover the pure state transitions and add the smallest practical integration assertion.

## Non-Goals

- Persisting custom sidebar width across app restarts.
- Building a full Structure tool window.
- Replacing semantic-worker document symbol support.
- Redesigning completion ranking or SDK completion quality.
- Changing existing quick open, command palette, search everywhere, or find usages semantics beyond keymap coexistence.
