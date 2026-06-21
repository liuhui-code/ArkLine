# ArkLine Terminal IDEA Alignment Design

Date: 2026-06-21
Status: Proposed
Scope: Replace the current command-runner panel with an IDEA-style embedded terminal tool window

## Goal

Bring ArkLine's bottom `Terminal` tool window much closer to IntelliJ IDEA by
turning it into a real embedded shell surface instead of a one-shot command
runner.

This milestone should deliver:

- a persistent shell session model
- an IDEA-like terminal tool window structure
- session tabs inside the terminal window
- direct keyboard interaction inside the terminal viewport
- a backend PTY service that preserves shell state across commands

The target is not full IDEA parity. The target is a correct first terminal
architecture that feels like an IDE terminal and will not need to be replaced
again later.

## Non-Goals

This milestone does not include:

- split terminal panes
- tab rename
- session persistence across full app restart
- remote / SSH terminals
- terminal search UI
- shell profile chooser UI
- run configuration integration
- task runner orchestration
- terminal-driven Git workflow features

It also does not attempt to preserve the current "preset command runner" as the
main terminal interaction model.

## User Requirements Confirmed

- The terminal should align closely with IDEA in both UI and behavior.
- The current command-runner design is not sufficient.
- Terminal should remain in the bottom tool window area.
- The result should focus on real terminal behavior first, not decorative UI.
- Existing large-file constraints still apply; terminal work must not push
  `AppShell.tsx` or any new class/file past the established limits.

## Current-State Assessment

ArkLine's current terminal is structurally a command execution panel, not a
terminal:

- command input happens in a dedicated text field
- commands are executed one request at a time
- output is rendered as result entries
- shell state does not persist naturally across interactions
- there are no terminal session tabs
- toolbar actions are task-oriented rather than session-oriented

This architecture prevents IDEA-like behaviors such as:

- `cd` followed by later commands in the same shell state
- interactive commands
- long-running processes inside one terminal session
- tabbed shell sessions
- a terminal viewport as the primary interaction surface

## Recommended Architecture

ArkLine should replace the current terminal execution model with a PTY-backed
terminal session model.

### Core Model

The system should treat terminal as a persistent shell host with these concepts:

- `TerminalSession`
- `TerminalSessionManager`
- `TerminalViewport`
- `TerminalToolWindow`

Terminal interaction must become event-driven rather than request/result-driven.

### Frontend Stack

Use `xterm.js` as the terminal renderer.

Responsibilities:

- render the terminal viewport
- forward keyboard input to the host PTY session
- receive streamed output and write it into the viewport
- handle resize events
- manage session tabs and active terminal state

The frontend must stop storing terminal output as React-rendered result cards.

### Rust Host Stack

Use a PTY-backed terminal service in the Tauri host.

Responsibilities:

- create and manage shell processes
- maintain per-session lifecycle state
- stream shell output back to the frontend
- accept terminal input writes from the frontend
- resize PTY dimensions as the terminal viewport changes
- terminate or close sessions cleanly

The host should expose terminal behavior as session commands and streaming
events, not as "run one command and return stdout/stderr".

## UI Structure

The outer bottom tool window remains unchanged at the shell level: `Terminal`
stays a peer of `Problems`, `Git`, and `Usages`.

Inside the `Terminal` tool window, the panel should become a three-layer layout.

### 1. Terminal Tab Strip

This row represents terminal sessions.

It should include:

- one tab per terminal session
- active-tab highlighting
- close action on each tab
- `+` action for new session creation

Default tab titles should use a compact, stable label such as:

- shell name, or
- current directory basename

The row should read like IDEA terminal tabs, not browser tabs and not editor
tabs.

### 2. Terminal Action Bar

This row is narrow and utility-focused.

Phase 1 actions:

- `New Tab`
- `Close`
- `Clear`
- `Stop`
- `More`

This row must not be dominated by task shortcuts such as `Lint`, `Format`, or
`Git Status`.

Those actions can survive elsewhere in the product, but they are not the core
terminal surface and should not define its layout.

### 3. Terminal Viewport

This is the primary surface.

Rules:

- use a single terminal canvas per active session
- accept direct keyboard input
- own scrollback behavior
- occupy almost all available panel height
- avoid card rendering, segmented result blocks, or detached command text fields

This is the most important IDEA-alignment rule:

- user input must happen inside the terminal viewport itself
- there should be no separate bottom `Run Command` input field in the final
  Phase 1 UI

## Interaction Model

### Open and Focus

- `Alt+F12` opens the `Terminal` bottom tool window if needed
- `Alt+F12` focuses the active terminal viewport
- if no session exists, `Alt+F12` creates one and focuses it

### Session Creation

Creating a terminal session should:

- choose the default shell for the host machine
- use workspace root as the working directory when available
- fall back to a safe directory if the workspace path is unavailable
- create a visible terminal tab immediately

### Session Behavior

Each terminal tab must preserve normal shell continuity:

- working directory changes remain in-session
- environment changes remain in-session
- long-running processes remain attached to the tab
- later commands execute in the same shell state

### Stop and Clear

- `Stop` terminates the current foreground process in the active session
- `Clear` clears the visible terminal buffer, not the session definition

### Context Actions

Phase 1 should include an "open in terminal" path from the workspace context.

Minimum supported entrypoints:

- workspace root
- selected file's parent directory or selected directory in the project tree

## Functional Scope

### Phase 1 Must Include

- real PTY shell session
- terminal session tabs
- create tab
- close tab
- switch tab
- clear active terminal buffer
- stop active foreground process
- workspace-root default working directory
- copy and paste through the terminal surface
- direct keyboard interaction
- scrollback in the terminal viewport
- `Alt+F12` open/focus behavior
- project-context open-in-terminal flow

### Phase 1 May Include if Cheap

- close other tabs
- close all tabs
- reopen session from the more menu
- rerun the last command by injecting text into the current terminal session

### Phase 1 Must Not Include

- split panes
- tab rename
- custom shell profile chooser UI
- persisted session restoration across app restart
- terminal search surface
- remote execution

## Preset Command Policy

The current preset actions:

- `Lint`
- `Format`
- `Git Status`

should not remain as primary terminal toolbar structure.

Recommended treatment:

- keep these capabilities elsewhere in ArkLine
- if needed, offer them as actions that write commands into the active terminal
  session
- do not let them define terminal layout or terminal state management

This is necessary to avoid preserving the current non-terminal mental model.

## Module Structure

### Frontend

Split the frontend into focused terminal modules:

- `TerminalToolWindow.tsx`
  - owns terminal-specific layout
  - owns tab strip and action bar composition

- `TerminalViewport.tsx`
  - owns one `xterm.js` instance
  - manages attach, resize, and disposal behavior

- `terminal-session-store.ts`
  - stores session list, active session, and session metadata

- `use-terminal-session-manager.ts`
  - talks to the backend
  - subscribes to output events
  - routes data to the correct session/viewport

- `terminal-actions.ts`
  - maps UI actions to terminal session behavior

This structure keeps terminal complexity out of `AppShell.tsx`.

### Rust Host

Split the Rust host into terminal-specific services:

- `terminal_session_service.rs`
  - session creation and lifecycle
  - PTY allocation
  - shell startup

- `terminal_io_service.rs`
  - session input writes
  - output stream reading
  - resize handling

- `terminal_commands.rs`
  - Tauri command surface

- `terminal_models.rs`
  - session DTOs and event payloads

This keeps PTY, IO, command routing, and models separated.

## Data Contracts

The minimum frontend-visible session model should be small and stable:

```ts
type TerminalSession = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: "starting" | "idle" | "running" | "closed" | "error";
};
```

```ts
type TerminalOutputChunk = {
  sessionId: string;
  data: string;
};
```

The Rust host should expose equivalent summary DTOs.

The goal is to keep terminal metadata separate from scrollback text. Scrollback
belongs to the terminal renderer, not to a large React state payload.

## Event Flow

The terminal event loop should follow this pattern:

1. frontend requests session creation
2. host starts a PTY shell
3. frontend receives `sessionId`
4. terminal viewport binds to the session
5. user keystrokes are written to the session
6. host streams output chunks back to the frontend
7. frontend writes chunks into the correct terminal viewport
8. viewport resize triggers PTY resize
9. tab close triggers session close

Required command/event surface:

- `createTerminalSession`
- `writeTerminalInput`
- `resizeTerminalSession`
- `closeTerminalSession`
- `listTerminalSessions`
- `terminal-output` event stream

## Error Handling

Terminal failures should degrade like an IDE tool window, not like a crashed
script:

- shell startup failure
  - keep the tab visible
  - show a terminal-local error message
  - mark session `error` or `closed`

- session exits normally
  - keep the tab
  - show a quiet completion marker in the terminal output

- session exits unexpectedly
  - keep the tab
  - mark status clearly
  - allow the user to create a new tab without reopening the whole tool window

- invalid workspace path
  - fall back to a valid directory
  - surface brief status text

- missing shell executable
  - report exact shell launch failure
  - do not crash terminal UI

- large output
  - rely on terminal scrollback configuration
  - avoid storing unbounded output in React result lists

## Platform Behavior

Windows is the primary target for this project.

Phase 1 should prioritize:

- PowerShell or PowerShell Core as preferred shell
- `cmd` fallback if needed
- PTY behavior that is stable on Windows

macOS support may remain development-grade, but the architecture should not
hard-code Windows assumptions into the frontend contracts.

## Testing Strategy

### Frontend Component Tests

Test:

- terminal tool window layout
- session tab strip rendering
- active session switching
- new-tab and close-tab behavior
- `Alt+F12` focus flow

### Frontend Session Tests

Test:

- session creation state updates
- output chunk routing to the correct terminal session
- clear and stop actions
- resize dispatch behavior

### Rust Host Tests

Test:

- PTY session creation
- session input/output flow
- session close cleanup
- foreground process stop behavior
- multiple-session isolation

### Manual Smoke Tests

Manual verification should include:

- open terminal with `Alt+F12`
- run `pwd` / `cd` / later command in the same tab
- run a long process
- stop that process
- open a second terminal tab
- switch tabs and verify state isolation
- open terminal from a workspace path context

## Implementation Phases

### Phase 1: Replace the Interaction Model

- remove one-shot terminal entry rendering from the primary UX
- introduce PTY session lifecycle and streaming output
- add a terminal viewport component

### Phase 2: Align the Terminal UI

- add terminal session tabs
- add terminal action bar
- move user input fully into the terminal viewport
- remove the detached command input field

### Phase 3: Restore Supporting Workflows

- wire open-in-terminal actions from workspace context
- add close-all / close-others if low cost
- relocate any remaining preset actions out of the terminal core

## Acceptance Criteria

ArkLine can claim this terminal milestone only when all of these are true:

- the terminal is a persistent shell session, not a command result panel
- user typing happens directly in the terminal viewport
- no standalone `Run Command` field remains in the final Phase 1 terminal UI
- output is shown in a continuous terminal buffer, not result cards
- session tabs exist and can be created, closed, and switched
- `Alt+F12` opens and focuses terminal behavior in an IDEA-like way
- active shell state persists across multiple commands in one tab
- terminal work does not enlarge `AppShell.tsx` or create new oversized files

## Recommendation

ArkLine should treat this as a replacement of the current terminal model, not an
incremental polish pass.

Continuing to decorate the existing command-runner architecture would produce a
surface that looks more like IDEA but still behaves unlike IDEA. Replacing the
interaction model now is the lower-risk path for future development.
