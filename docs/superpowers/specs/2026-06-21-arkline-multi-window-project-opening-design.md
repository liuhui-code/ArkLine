# ArkLine Multi-Window Project Opening Design

## Goal

Align ArkLine's project-opening behavior with IDEA-style desktop expectations:

- If the current window is empty, opening a project should reuse the current window.
- If the current window already has a workspace loaded, opening a project should ask whether to open it in the current window or a new window.
- Recent projects must follow the same decision flow.

This change is limited to project-opening behavior. It does not introduce session restore, workspace groups, or cross-window coordination beyond creating a new window with an initial workspace path.

## Product Behavior

### Decision Rules

ArkLine will use these rules for all project-opening entry points:

1. If no workspace is loaded in the current window, open the selected project in the current window immediately.
2. If a workspace is already loaded, show an `Open Project` decision dialog with:
   - `This Window`
   - `New Window`
   - `Cancel`
3. `Cancel` leaves the current window completely unchanged.

### Entry Points

The following entry points must use the same decision flow:

- `File -> Open Project...`
- Recent Projects list
- Any command-palette action that opens a project path

There must be one shared project-opening decision function in the frontend. Entry points must not implement separate logic branches.

### This Window

Choosing `This Window` reuses the current ArkLine window and follows the existing workspace replacement flow:

- open selected workspace
- clear open tabs
- clear editor selection/insert state
- clear terminal sessions
- clear diff/problems/usages transient state
- refresh semantic state for the new workspace

### New Window

Choosing `New Window` creates a second ArkLine application window and loads the selected workspace there.

Requirements:

- the current window keeps its current workspace and UI state
- the new window starts with the selected workspace path already attached
- the new window auto-opens that workspace during startup
- the new window behaves like a normal first-class ArkLine window after launch

No live synchronization between windows is required for MVP.

## UX Design

### Dialog

When a workspace is already open and the user selects another project, ArkLine shows a compact IDEA-like modal dialog:

- Title: `Open Project`
- Message: `Open "<project name>" in this window or a new window?`
- Actions:
  - `This Window`
  - `New Window`
  - `Cancel`

### Behavior Notes

- The dialog appears only when the current window already has a workspace.
- The dialog is reused for recent-project selection.
- Keyboard behavior:
  - `Escape` closes the dialog as `Cancel`
  - focus remains trapped in the dialog while it is open
  - after `Cancel`, focus returns to the previously active editor or shell surface

## Architecture

### Frontend Responsibilities

Frontend React code is responsible for:

- determining whether the current window is empty or already has a workspace
- opening the decision dialog when required
- routing the user's decision into either:
  - existing `openWorkspace(rootPath)` flow
  - new backend command for opening a workspace in a new window

The frontend must not create windows directly through ad hoc code paths scattered across menus or overlays.

### Backend Responsibilities

Rust/Tauri backend is responsible for:

- creating a new app window
- passing the selected workspace path into that window
- exposing the initial workspace path to the frontend during boot

The backend remains the only owner of native window lifecycle behavior.

### Window Bootstrap Contract

Add a typed contract for secondary-window startup:

- `open_workspace_in_new_window(root_path)` command
- `get_launch_workspace_path()` command or equivalent typed bootstrap accessor

The new window must be able to discover whether it was launched with a workspace path and, if so, open it automatically once the shell initializes.

## State and Data Flow

### Existing Window

When `This Window` is chosen:

1. user selects a project path
2. AppShell decides the current window is occupied
3. decision dialog opens
4. user chooses `This Window`
5. existing `openWorkspace(rootPath)` path executes

### New Window

When `New Window` is chosen:

1. user selects a project path
2. AppShell decides the current window is occupied
3. decision dialog opens
4. user chooses `New Window`
5. frontend invokes backend new-window command
6. backend creates a new ArkLine window with launch payload
7. new window bootstraps
8. AppShell reads launch workspace path
9. new window auto-opens selected workspace

## Error Handling

### New Window Creation Failure

If backend window creation fails:

- keep the current window unchanged
- close the decision dialog
- show status text with the failure reason
- do not silently fall back to replacing the current workspace

### Workspace Open Failure In New Window

If the new window launches but cannot open the workspace:

- show the existing project-open error UX inside the new window
- keep the original window unchanged

### Invalid Recent Project Path

Recent project entries continue to use existing error behavior if the path cannot be opened. The only change is that the decision dialog appears first when the current window is occupied.

## Testing

### Frontend Tests

Add regression coverage for:

1. empty window + `Open Project...` opens in current window without showing the decision dialog
2. occupied window + `Open Project...` shows the decision dialog
3. occupied window + `This Window` replaces the current workspace
4. occupied window + `New Window` invokes the backend new-window API and leaves current workspace unchanged
5. occupied window + recent project selection shows the same decision dialog
6. `Cancel` leaves editor tabs and current workspace unchanged

### Backend Tests

Add focused Rust coverage for:

- new-window command validates input path payload shape
- launch workspace payload is retrievable by the newly created window bootstrap path

## Scope Limits

This design explicitly does not include:

- reopen previous windows on next app launch
- "attach project" or multi-root workspace support
- window lists or project switchers
- inter-window synchronization
- user-configurable default behavior such as "always new window" or "always this window"

Those can be added later after the IDEA-style `ask when occupied` behavior is stable.
