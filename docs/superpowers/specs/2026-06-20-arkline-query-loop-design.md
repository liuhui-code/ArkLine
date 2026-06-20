# ArkLine Query Loop Design

Last updated: 2026-06-20

## Goal

Bring ArkLine from "semantic commands exist" to a minimum IDE-style query loop
for ArkTS code reading.

This phase adds one coherent workflow:

1. jump from a symbol use to its definition
2. query usages of the same symbol
3. inspect the result list
4. jump back into source from a result item

The intent is not to match the full IntelliJ feature set. The intent is to
make code reading and tracing materially faster on small and medium ArkTS
projects.

## Scope

### In scope

- `Ctrl+Click` to jump to definition
- `Ctrl+B` to jump to definition
- `Alt+F7` to find usages
- command-palette entries for `Go to Definition` and `Find Usages`
- a bottom `Usages` tool window
- click-through navigation from usage results to source
- mock and real-provider compatibility through one frontend API contract

### Out of scope

- rename symbol
- peek definition
- type hierarchy
- call hierarchy
- inline preview editor for usages
- multi-target definition chooser
- workspace symbol search
- current-file occurrence highlighting

This phase is a query loop only. It is intentionally narrower than a general
language-intelligence milestone.

## User Experience

### Definition flow

The user is reading ArkTS code and wants to move to a declaration quickly.

- `Ctrl+B` runs `Go to Definition` on the current editor symbol
- `Ctrl+Click` on a symbol also runs `Go to Definition`
- if a definition target exists:
  - the file is opened if needed
  - the editor caret moves to the target
  - the editor regains focus
- if no target exists:
  - the editor remains in place
  - the status bar shows a short failure message

First version behavior for `Ctrl+Click` is intentionally simplified. It will
use the current editor position and the click gesture as a trigger, without
building a precise symbol-hover hit-test layer first. Once a real ArkTS
provider can return accurate ranges, the clickable state can become stricter.

### Usages flow

The user wants to see where a symbol is used without leaving the current
investigation context.

- `Alt+F7` runs `Find Usages` on the current editor symbol
- the command palette also exposes `Find Usages`
- when the query starts:
  - the bottom tool window opens
  - the selected tab becomes `Usages`
  - the status bar shows `Finding usages...`
- when results arrive:
  - the `Usages` tab stays open
  - the list displays the result count and items
  - the status bar shows `Usages: N results`
- when no results arrive:
  - the tab still opens
  - the panel shows an empty-state message
  - the status bar shows `No usages found`
- clicking a usage result:
  - opens the file if needed
  - moves the caret to the target line and column
  - returns focus to the editor
  - keeps the `Usages` panel available for additional jumps

## UI Placement

### Editor surface

Definition entry belongs in the editor surface, not in overlays.

- `Ctrl+B` is the keyboard-first entry
- `Ctrl+Click` is the mouse-first entry
- no floating definition preview is added in this phase
- hover styling, if present, stays minimal and non-blocking

### Bottom tool window

A new `Usages` tab is added beside the existing bottom tools.

- same level as `Problems`, `Terminal`, and `Git`
- not a modal
- not a transient overlay

First version panel layout:

- single results list
- each item shows:
  - file name
  - line and column
  - a short preview line

Grouped-by-file rendering is allowed if it stays small and readable, but it is
not required for the first pass. The first pass optimizes for stable behavior,
not for advanced result presentation.

### Status bar

The status bar carries short query feedback only:

- `Finding usages...`
- `Usages: 8 results`
- `No usages found`
- `Definition: Index.ets:14:3`
- `Definition not found`
- `Language service unavailable`

The status bar is not used for long-lived query state visualization.

## Architecture

The feature is split into four layers.

### 1. Editor interaction layer

Responsibilities:

- observe current caret position
- trigger semantic queries from hotkeys or click gestures
- pass jump targets back into the existing editor focus and selection flow

Non-responsibilities:

- no provider-specific logic
- no result persistence
- no usage list rendering

### 2. Workspace semantic API

The existing language-service-shaped frontend API becomes the single semantic
boundary.

Required methods after this phase:

- `gotoDefinition(request)`
- `completeSymbol(request)`
- `findUsages(request)`

`findUsages` is added alongside the existing semantic calls, with the same
mock-first and backend-compatible shape.

Suggested result type:

```ts
type UsageResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
};
```

The frontend must not care whether the response came from:

- a mock implementation
- a Tauri command
- a future ArkTS language-service adapter

### 3. Shell state layer

Definition and usages are modeled differently on purpose.

Definition is an action, not a persistent result set. It should reuse the
existing navigation mechanism:

- `openFile`
- `selectionTarget`
- `focusToken`

Usages is persistent view state and needs dedicated shell state:

```ts
type UsageSearchState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  items: UsageResult[];
  requestedSymbol?: {
    path: string;
    line: number;
    column: number;
    symbolText?: string;
  };
  message?: string;
};
```

The bottom tool selection enum must add:

- `usages`

### 4. Results presentation layer

A dedicated `UsagesPanel` is introduced.

Responsibilities:

- render loading state
- render empty state
- render error state
- render usage items
- notify the shell when a result is chosen

Non-responsibilities:

- no direct file opening
- no provider calls
- no hidden editor state mutations

## Interaction Rules

### Rule 1: definition never opens a secondary chooser in this phase

If the provider returns one target, jump directly.

If the provider cannot resolve uniquely in the future, the first phase still
prefers a deterministic fallback or a short failure path over adding another
popup surface prematurely.

### Rule 2: usages always opens the bottom tool window

Do not split usages across status bar, popup, and panel. The result set needs a
stable place in the UI.

### Rule 3: result clicks keep the query context alive

Jumping from one usage to source must not clear the result set automatically.
The user should be able to inspect several hits without re-running the query.

### Rule 4: missing provider support degrades explicitly

If the semantic provider is missing:

- commands remain callable
- failures are explicit and quiet
- UI shows unavailable or empty states
- the editor must not lose focus or content

## Implementation Plan Boundaries

This phase should be implemented as one narrow feature package, but the code
must remain split into focused modules.

Likely touched files:

- `src/components/layout/AppShell.tsx`
- `src/components/layout/shell-keymap.ts`
- `src/components/layout/EditorSurface.tsx`
- `src/editor/ArkTsEditor.tsx`
- `src/features/workspace/workspace-api.ts`

Likely new files:

- `src/components/layout/UsagesPanel.tsx`
- `src/features/workspace/usage-search.ts`

Hard constraints:

- keep `AppShell.tsx` under 500 lines
- do not move usages into the completion overlay path
- do not couple panel rendering directly to provider transport details

## Testing Strategy

### Automated frontend tests

Required:

- `Ctrl+B` triggers definition query and navigates
- `Ctrl+Click` triggers definition query and navigates
- `Alt+F7` triggers usage query and opens the `Usages` tab
- usage result list renders
- clicking a usage result opens and positions the editor
- empty usages state renders correctly
- unavailable-provider state renders correctly

### Existing regression protection

Must remain green:

- app shell regression suite
- shell hotkey suite
- language-service API suite

### Build verification

Required:

- `pnpm build`

## Acceptance Criteria

This phase is complete only when all of these are true:

- `Ctrl+B` works on the current symbol path
- `Ctrl+Click` works as a definition trigger
- `Alt+F7` opens a stable `Usages` result tab
- usage results can be clicked through to source
- empty and unavailable states are explicit
- the semantic UI works with the mock provider contract
- the frontend still builds cleanly
- `AppShell.tsx` remains under the 500-line limit

## Open Follow-up, Explicitly Deferred

The following are expected next steps, but they are not part of this design:

- replace mock definition and usages with a real ArkTS provider
- improve symbol hit-testing for `Ctrl+Click`
- add grouped results or inline preview in `Usages`
- add hover documentation
- add rename and broader semantic tooling

This design intentionally stops at the first trustworthy query loop.
