# ArkLine Terminal IDEA Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ArkLine's current one-shot terminal command runner with an IDEA-style PTY-backed terminal tool window that supports persistent shell sessions and terminal tabs.

**Architecture:** Introduce a PTY session service in the Tauri host, expose terminal-session lifecycle commands plus streamed output, and move the frontend terminal UI onto `xterm.js` with a dedicated terminal tool-window composition layer. Preserve the outer bottom tool window, but replace the current terminal entry-card model and detached command input with a real terminal viewport and session tabs.

**Tech Stack:** Tauri v2, Rust, portable-pty, tauri event emission, React 19, TypeScript, xterm.js, Vitest

---

### File Structure

**Frontend terminal files**

- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalToolWindow.tsx`
  - Own terminal-specific layout: tab strip, action bar, active viewport
- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalViewport.tsx`
  - Own one `xterm.js` instance and bind it to one session
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/terminal/terminal-session-manager.ts`
  - Frontend API wrapper for session lifecycle commands and output events
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/terminal/terminal-tabs-store.ts`
  - Track session summaries, active tab, and session status
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
  - Replace one-shot terminal methods with session lifecycle methods
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
  - Wire the new terminal tool window without growing past 500 lines
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
  - Add IDEA-style terminal tab strip, toolbar, and viewport chrome

**Frontend tests**

- Create: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/terminal-tool-window.test.tsx`
  - Cover tab strip, `Alt+F12`, new tab, close tab, and clear/stop UI behavior
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`
  - Update shell assertions for the new terminal surface
- Delete or rewrite: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/terminal-panel.test.tsx`
  - Replace current entry-card expectations with session-based terminal expectations

**Rust terminal files**

- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_session_service.rs`
  - PTY allocation, shell startup, session lifecycle
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_io_service.rs`
  - Input writes, resize handling, output reader threads
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/terminal.rs`
  - Replace run-request/result DTOs with session DTOs and output chunk payloads
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_service.rs`
  - Convert runtime into a session registry instead of a one-shot child-process map
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/commands/terminal.rs`
  - Expose create/write/resize/close/list commands
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/lib.rs`
  - Register the new terminal commands and any event wiring

**Rust tests**

- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_service.rs`
  - Replace one-shot command tests with session lifecycle tests

**Docs**

- Modify: `/Users/liuhui/Documents/code/ArkLine/README.md`
  - Update terminal feature description and shortcut/workflow notes
- Modify: `/Users/liuhui/Documents/code/ArkLine/gitlog.md`
  - Add a concise terminal milestone entry

### Task 1: Replace the Terminal Data Model and Frontend API Surface

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/terminal/terminal-types.ts`
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/terminal/terminal-tabs-store.ts`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/terminal-tool-window.test.tsx`

- [ ] **Step 1: Write the failing frontend store test for session tabs**

```ts
import { createTerminalTabsStore } from "@/features/terminal/terminal-tabs-store";

describe("terminal tabs store", () => {
  it("creates, activates, and closes terminal sessions", () => {
    const store = createTerminalTabsStore();

    store.addSession({
      id: "session-1",
      title: "pwsh",
      cwd: "C:\\samples\\ArkDemo",
      shell: "pwsh",
      status: "idle",
    });
    store.addSession({
      id: "session-2",
      title: "entry",
      cwd: "C:\\samples\\ArkDemo\\entry",
      shell: "pwsh",
      status: "running",
    });

    expect(store.state.activeSessionId).toBe("session-2");
    expect(store.state.sessions.map((session) => session.id)).toEqual(["session-1", "session-2"]);

    store.setActiveSession("session-1");
    expect(store.state.activeSessionId).toBe("session-1");

    store.closeSession("session-1");
    expect(store.state.activeSessionId).toBe("session-2");
    expect(store.state.sessions.map((session) => session.id)).toEqual(["session-2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- terminal-tool-window`

Expected: FAIL because `terminal-tabs-store.ts` and the new session model do not exist yet.

- [ ] **Step 3: Replace the terminal API contracts in `workspace-api.ts`**

```ts
export type TerminalSessionSummary = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: "starting" | "idle" | "running" | "closed" | "error";
};

export type CreateTerminalSessionRequest = {
  cwd: string | null;
};

export type TerminalInputWriteRequest = {
  sessionId: string;
  data: string;
};

export type TerminalResizeRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};

export type WorkspaceApi = {
  // existing members...
  createTerminalSession(request: CreateTerminalSessionRequest): Promise<TerminalSessionSummary>;
  listTerminalSessions(): Promise<TerminalSessionSummary[]>;
  writeTerminalInput(request: TerminalInputWriteRequest): Promise<void>;
  resizeTerminalSession(request: TerminalResizeRequest): Promise<void>;
  closeTerminalSession(sessionId: string): Promise<void>;
  stopTerminalSession(sessionId: string): Promise<void>;
};
```

```ts
async createTerminalSession(request) {
  if (hasTauriRuntime()) {
    return invoke<TerminalSessionSummary>("create_terminal_session", { request });
  }

  return {
    id: "session-1",
    title: "pwsh",
    cwd: normalizePath(request.cwd ?? "C:/samples/DemoWorkspace"),
    shell: "pwsh",
    status: "idle",
  };
}
```

- [ ] **Step 4: Replace the old terminal entry model in `terminal-types.ts`**

```ts
export type TerminalSessionStatus = "starting" | "idle" | "running" | "closed" | "error";

export type TerminalSessionSummary = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: TerminalSessionStatus;
};

export type TerminalTabsState = {
  sessions: TerminalSessionSummary[];
  activeSessionId: string | null;
};
```

- [ ] **Step 5: Implement the minimal terminal tabs store**

```ts
import type { TerminalSessionSummary, TerminalTabsState } from "@/features/terminal/terminal-types";

export function createTerminalTabsStore() {
  const state: TerminalTabsState = {
    sessions: [],
    activeSessionId: null,
  };

  return {
    state,
    addSession(session: TerminalSessionSummary) {
      state.sessions = [...state.sessions.filter((item) => item.id !== session.id), session];
      state.activeSessionId = session.id;
    },
    setActiveSession(sessionId: string) {
      if (state.sessions.some((session) => session.id === sessionId)) {
        state.activeSessionId = sessionId;
      }
    },
    closeSession(sessionId: string) {
      const nextSessions = state.sessions.filter((session) => session.id !== sessionId);
      state.sessions = nextSessions;
      state.activeSessionId = nextSessions.at(-1)?.id ?? null;
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- terminal-tool-window`

Expected: PASS with the new session-based API types and tab-store behavior.

- [ ] **Step 7: Commit**

```bash
git add src/features/workspace/workspace-api.ts src/features/terminal/terminal-types.ts src/features/terminal/terminal-tabs-store.ts tests/frontend/terminal-tool-window.test.tsx
git commit -m "feat: add terminal session models and tab store"
```

### Task 2: Introduce a PTY Session Runtime in the Tauri Host

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/Cargo.toml`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/models/terminal.rs`
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_session_service.rs`
- Create: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_io_service.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_service.rs`
- Test: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_service.rs`

- [ ] **Step 1: Write the failing Rust session lifecycle test**

```rust
#[test]
fn creates_lists_and_closes_terminal_sessions() {
    let runtime = TerminalRuntime::default();
    let session = create_session(&runtime, CreateTerminalSessionRequest { cwd: None }).unwrap();

    assert_eq!(list_sessions(&runtime).len(), 1);
    assert_eq!(session.status, "idle");

    close_session(&runtime, &session.id).unwrap();
    assert!(list_sessions(&runtime).is_empty());
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test creates_lists_and_closes_terminal_sessions`

Expected: FAIL because the PTY session API does not exist yet.

- [ ] **Step 3: Add the PTY dependency**

```toml
[dependencies]
portable-pty = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tauri = { version = "2", features = [] }
tauri-plugin-dialog = "2"
```

- [ ] **Step 4: Replace the terminal Rust models**

```rust
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionRequest {
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalInputWriteRequest {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSummary {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub shell: String,
    pub status: String,
}
```

- [ ] **Step 5: Create the PTY session service skeleton**

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

pub fn spawn_terminal_session(
    cwd: Option<&str>,
) -> Result<(Box<dyn portable_pty::MasterPty + Send>, Box<dyn portable_pty::Child + Send>, String), String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 30,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let shell = if cfg!(windows) { "pwsh" } else { "sh" };
    let mut command = CommandBuilder::new(shell);
    if let Some(path) = cwd.filter(|value| !value.trim().is_empty()) {
        command.cwd(path);
    }

    let child = pair.slave.spawn_command(command).map_err(|error| error.to_string())?;
    Ok((pair.master, child, shell.to_string()))
}
```

- [ ] **Step 6: Convert `TerminalRuntime` into a session registry**

```rust
pub struct TerminalRuntime {
    sessions: Mutex<HashMap<String, TerminalSessionHandle>>,
    next_id: AtomicU64,
}

pub fn create_session(
    runtime: &TerminalRuntime,
    request: CreateTerminalSessionRequest,
) -> Result<TerminalSessionSummary, String> {
    let session_id = format!("session-{}", runtime.next_id.fetch_add(1, Ordering::SeqCst) + 1);
    let (master, child, shell) = spawn_terminal_session(request.cwd.as_deref())?;
    let cwd = request.cwd.unwrap_or_else(default_terminal_cwd);
    runtime.sessions.lock().expect("terminal session lock").insert(
        session_id.clone(),
        TerminalSessionHandle::new(master, child, cwd.clone(), shell.clone()),
    );

    Ok(TerminalSessionSummary {
        id: session_id,
        title: shell.clone(),
        cwd,
        shell,
        status: "idle".to_string(),
    })
}
```

- [ ] **Step 7: Implement list and close behavior**

```rust
pub fn list_sessions(runtime: &TerminalRuntime) -> Vec<TerminalSessionSummary> {
    runtime
        .sessions
        .lock()
        .expect("terminal session lock")
        .iter()
        .map(|(id, handle)| TerminalSessionSummary {
            id: id.clone(),
            title: handle.title.clone(),
            cwd: handle.cwd.clone(),
            shell: handle.shell.clone(),
            status: handle.status(),
        })
        .collect()
}

pub fn close_session(runtime: &TerminalRuntime, session_id: &str) -> Result<(), String> {
    let handle = runtime
        .sessions
        .lock()
        .expect("terminal session lock")
        .remove(session_id);

    if let Some(handle) = handle {
        handle.kill()?;
    }

    Ok(())
}
```

- [ ] **Step 8: Run Rust tests to verify they pass**

Run: `cargo test terminal_service`

Expected: PASS with the session registry replacing the one-shot child-process runtime.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/models/terminal.rs src-tauri/src/services/terminal_session_service.rs src-tauri/src/services/terminal_io_service.rs src-tauri/src/services/terminal_service.rs
git commit -m "feat: add PTY-backed terminal session runtime"
```

### Task 3: Expose Terminal Session Commands and Streamed Output

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/commands/terminal.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/lib.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/workspace/workspace-api.ts`
- Create: `/Users/liuhui/Documents/code/ArkLine/src/features/terminal/terminal-session-manager.ts`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/terminal-tool-window.test.tsx`

- [ ] **Step 1: Write the failing frontend manager test for session creation and event subscription**

```ts
import { createTerminalSessionManager } from "@/features/terminal/terminal-session-manager";

describe("terminal session manager", () => {
  it("creates a session and tracks streamed output", async () => {
    const writes: string[] = [];
    const manager = createTerminalSessionManager({
      workspaceApi: {
        createTerminalSession: async () => ({
          id: "session-1",
          title: "pwsh",
          cwd: "C:\\samples\\ArkDemo",
          shell: "pwsh",
          status: "idle",
        }),
        listTerminalSessions: async () => [],
        writeTerminalInput: async () => undefined,
        resizeTerminalSession: async () => undefined,
        closeTerminalSession: async () => undefined,
        stopTerminalSession: async () => undefined,
      } as never,
      subscribeOutput(sessionId, onData) {
        expect(sessionId).toBe("session-1");
        onData("hello");
        writes.push("subscribed");
        return () => writes.push("disposed");
      },
    });

    const session = await manager.createSession("C:\\samples\\ArkDemo");
    expect(session.id).toBe("session-1");
    expect(manager.getOutput("session-1")).toBe("hello");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- terminal-tool-window`

Expected: FAIL because the session manager and output subscription model do not exist.

- [ ] **Step 3: Expose session lifecycle Tauri commands**

```rust
#[tauri::command]
pub fn create_terminal_session(
    runtime: State<TerminalRuntime>,
    request: CreateTerminalSessionRequest,
) -> Result<TerminalSessionSummary, String> {
    create_session(runtime.inner(), request)
}

#[tauri::command]
pub fn list_terminal_sessions(runtime: State<TerminalRuntime>) -> Result<Vec<TerminalSessionSummary>, String> {
    Ok(list_sessions(runtime.inner()))
}

#[tauri::command]
pub fn close_terminal_session(runtime: State<TerminalRuntime>, session_id: String) -> Result<(), String> {
    close_session(runtime.inner(), &session_id)
}
```

- [ ] **Step 4: Register the new commands in `lib.rs`**

```rust
        .invoke_handler(tauri::generate_handler![
            // existing commands...
            commands::terminal::create_terminal_session,
            commands::terminal::list_terminal_sessions,
            commands::terminal::write_terminal_input,
            commands::terminal::resize_terminal_session,
            commands::terminal::close_terminal_session,
            commands::terminal::stop_terminal_session
        ])
```

- [ ] **Step 5: Add the frontend session manager wrapper**

```ts
import type { WorkspaceApi, TerminalSessionSummary } from "@/features/workspace/workspace-api";

export function createTerminalSessionManager({
  workspaceApi,
  subscribeOutput,
}: {
  workspaceApi: WorkspaceApi;
  subscribeOutput: (sessionId: string, onData: (data: string) => void) => () => void;
}) {
  const outputBySession = new Map<string, string>();

  return {
    async createSession(cwd: string | null) {
      const session = await workspaceApi.createTerminalSession({ cwd });
      subscribeOutput(session.id, (data) => {
        outputBySession.set(session.id, `${outputBySession.get(session.id) ?? ""}${data}`);
      });
      return session;
    },
    getOutput(sessionId: string) {
      return outputBySession.get(sessionId) ?? "";
    },
  };
}
```

- [ ] **Step 6: Run the frontend tests to verify they pass**

Run: `pnpm test -- terminal-tool-window`

Expected: PASS with the session manager wrapping the new session commands.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/terminal.rs src-tauri/src/lib.rs src/features/workspace/workspace-api.ts src/features/terminal/terminal-session-manager.ts tests/frontend/terminal-tool-window.test.tsx
git commit -m "feat: expose terminal session lifecycle commands"
```

### Task 4: Replace the Terminal Panel UI with an IDEA-Style Terminal Tool Window

**Files:**
- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalToolWindow.tsx`
- Create: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalViewport.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/BottomToolWindow.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/styles/app.css`
- Modify: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`
- Delete or replace: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalPanel.tsx`

- [ ] **Step 1: Write the failing shell test for terminal tabs and viewport focus**

```tsx
it("opens an IDEA-style terminal viewport and creates a session tab on Alt+F12", async () => {
  const user = userEvent.setup();
  render(<AppShell workspaceApi={createWorkspaceApi()} />);

  await user.keyboard("{Alt>}{F12}{/Alt}");

  expect(await screen.findByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("tab", { name: "pwsh" })).toBeVisible();
  expect(await screen.findByLabelText("Terminal Viewport")).toHaveFocus();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- app-shell terminal-tool-window`

Expected: FAIL because the UI still renders the old terminal panel with buttons and a detached input field.

- [ ] **Step 3: Introduce the terminal tool window shell**

```tsx
type TerminalToolWindowProps = {
  sessions: TerminalSessionSummary[];
  activeSessionId: string | null;
  onCreateSession: () => void;
  onCloseSession: (sessionId: string) => void;
  onSetActiveSession: (sessionId: string) => void;
  onClearSession: () => void;
  onStopSession: () => void;
};

export function TerminalToolWindow(props: TerminalToolWindowProps) {
  return (
    <section aria-label="Terminal Panel" className="bottom-tool-window__panel">
      <div className="terminal-tool-window">
        <div className="terminal-tool-window__tabs" role="tablist" aria-label="Terminal Sessions">
          {props.sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              role="tab"
              aria-selected={props.activeSessionId === session.id}
              className="terminal-tool-window__tab"
              onClick={() => props.onSetActiveSession(session.id)}
            >
              {session.title}
            </button>
          ))}
          <button type="button" className="terminal-tool-window__tab-add" onClick={props.onCreateSession}>+</button>
        </div>
        <div className="terminal-tool-window__toolbar" role="toolbar" aria-label="Terminal Session Actions">
          <button type="button" onClick={props.onClearSession}>Clear</button>
          <button type="button" onClick={props.onStopSession}>Stop</button>
        </div>
        <TerminalViewport sessionId={props.activeSessionId} />
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Replace the old terminal panel usage in `AppShell.tsx`**

```tsx
        terminalPanel={
          <TerminalToolWindow
            sessions={terminalTabs.sessions}
            activeSessionId={terminalTabs.activeSessionId}
            onCreateSession={() => void createTerminalTab(workspace?.rootPath ?? null)}
            onCloseSession={(sessionId) => void closeTerminalTab(sessionId)}
            onSetActiveSession={setActiveTerminalTab}
            onClearSession={clearActiveTerminalBuffer}
            onStopSession={() => void stopActiveTerminalSession()}
          />
        }
```

- [ ] **Step 5: Add the minimal terminal viewport**

```tsx
import { useEffect, useRef } from "react";

export function TerminalViewport({ sessionId }: { sessionId: string | null }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    viewportRef.current?.focus();
  }, [sessionId]);

  return (
    <div
      ref={viewportRef}
      aria-label="Terminal Viewport"
      className="terminal-tool-window__viewport"
      tabIndex={0}
    />
  );
}
```

- [ ] **Step 6: Apply IDEA-like terminal styles**

```css
.terminal-tool-window {
  display: grid;
  grid-template-rows: 28px 28px minmax(0, 1fr);
  height: 100%;
  background: #1e1f22;
}

.terminal-tool-window__tabs {
  display: flex;
  align-items: end;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.terminal-tool-window__viewport {
  min-height: 0;
  outline: none;
}
```

- [ ] **Step 7: Run frontend tests to verify they pass**

Run: `pnpm test -- app-shell terminal-tool-window`

Expected: PASS with the detached input/entry-card UI removed and the session-tab terminal shell in place.

- [ ] **Step 8: Commit**

```bash
git add src/components/layout/TerminalToolWindow.tsx src/components/layout/TerminalViewport.tsx src/components/layout/AppShell.tsx src/components/layout/BottomToolWindow.tsx src/styles/app.css tests/frontend/app-shell.test.tsx tests/frontend/terminal-tool-window.test.tsx
git commit -m "feat: replace terminal panel with terminal tool window"
```

### Task 5: Integrate xterm.js and Real Session IO

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/package.json`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalViewport.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/features/terminal/terminal-session-manager.ts`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_io_service.rs`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src-tauri/src/services/terminal_service.rs`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/terminal-tool-window.test.tsx`

- [ ] **Step 1: Write the failing frontend viewport test for keyboard input forwarding**

```tsx
it("forwards terminal keystrokes to the active session writer", async () => {
  const user = userEvent.setup();
  const writeTerminalInput = vi.fn(async () => undefined);

  render(<AppShell workspaceApi={createWorkspaceApi({ writeTerminalInput })} />);
  await user.keyboard("{Alt>}{F12}{/Alt}");
  await user.keyboard("pwd{Enter}");

  expect(writeTerminalInput).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionId: "session-1",
      data: expect.stringContaining("pwd"),
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- terminal-tool-window`

Expected: FAIL because the viewport does not yet use `xterm.js` or forward input to the backend.

- [ ] **Step 3: Add the frontend dependency**

```json
"dependencies": {
  "xterm": "^5.5.0",
  "xterm-addon-fit": "^0.10.0",
  "@codemirror/commands": "^6.10.3"
}
```

- [ ] **Step 4: Bind `xterm.js` inside `TerminalViewport.tsx`**

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";

export function TerminalViewport({
  sessionId,
  onData,
}: {
  sessionId: string | null;
  onData: (data: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);

  useEffect(() => {
    if (!hostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({ cursorBlink: true, scrollback: 3000 });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    fitAddon.fit();
    terminal.onData(onData);
    terminalRef.current = terminal;

    return () => terminal.dispose();
  }, [onData]);

  return <div ref={hostRef} aria-label="Terminal Viewport" className="terminal-tool-window__viewport" />;
}
```

- [ ] **Step 5: Implement session write and output streaming in Rust**

```rust
pub fn write_input(runtime: &TerminalRuntime, request: &TerminalInputWriteRequest) -> Result<(), String> {
    let mut sessions = runtime.sessions.lock().expect("terminal session lock");
    let session = sessions
        .get_mut(&request.session_id)
        .ok_or_else(|| format!("Unknown terminal session: {}", request.session_id))?;
    session.write_all(request.data.as_bytes())
}
```

```rust
thread::spawn(move || {
    let mut reader = reader;
    let mut buffer = [0u8; 4096];
    loop {
        let size = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(size) => size,
            Err(_) => break,
        };

        let chunk = String::from_utf8_lossy(&buffer[..size]).to_string();
        let _ = app_handle.emit("terminal-output", TerminalOutputChunk {
            session_id: session_id.clone(),
            data: chunk,
        });
    }
});
```

- [ ] **Step 6: Run verification**

Run: `pnpm test -- terminal-tool-window app-shell`

Run: `cargo test terminal_service`

Expected: PASS with xterm-based input forwarding and PTY output streaming in place.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/components/layout/TerminalViewport.tsx src/features/terminal/terminal-session-manager.ts src-tauri/src/services/terminal_io_service.rs src-tauri/src/services/terminal_service.rs
git commit -m "feat: wire xterm viewport to PTY session io"
```

### Task 6: Polish IDEA Workflows, Remove Legacy Terminal Surface, and Update Docs

**Files:**
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TopBar.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/AppShell.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/ShellStatusBar.tsx`
- Modify: `/Users/liuhui/Documents/code/ArkLine/README.md`
- Modify: `/Users/liuhui/Documents/code/ArkLine/gitlog.md`
- Delete: `/Users/liuhui/Documents/code/ArkLine/src/components/layout/TerminalPanel.tsx`
- Test: `/Users/liuhui/Documents/code/ArkLine/tests/frontend/app-shell.test.tsx`

- [ ] **Step 1: Write the failing workflow test for session continuity and legacy-input removal**

```tsx
it("uses a real terminal viewport instead of the legacy command input workflow", async () => {
  render(<AppShell workspaceApi={createWorkspaceApi()} />);

  expect(screen.queryByLabelText("Terminal Command")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Run Command" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- app-shell`

Expected: FAIL until the last legacy terminal input affordances are removed.

- [ ] **Step 3: Remove the legacy terminal panel file and references**

```tsx
// delete TerminalPanel.tsx entirely once TerminalToolWindow owns the full terminal UI
```

- [ ] **Step 4: Update shell and docs text**

```md
- `Alt+F12`: open or focus the active terminal session
- Terminal now uses session tabs and an embedded shell viewport
```

- [ ] **Step 5: Run final verification**

Run: `pnpm test -- app-shell terminal-tool-window`

Run: `cargo test`

Run: `pnpm build`

Expected: PASS across frontend tests, Rust tests, and the production build, with no legacy terminal input workflow left in the UI.

- [ ] **Step 6: Commit**

```bash
git add src/components/layout/TopBar.tsx src/components/layout/AppShell.tsx src/components/layout/ShellStatusBar.tsx README.md gitlog.md
git rm src/components/layout/TerminalPanel.tsx
git commit -m "feat: finalize idea-style terminal workflow"
```

## Self-Review

- Spec coverage: the plan covers session tabs, PTY session architecture, direct terminal viewport input, `Alt+F12`, context-ready terminal opening, and explicit removal of the legacy command-runner surface.
- Placeholder scan: no `TODO`, `TBD`, or "similar to above" shortcuts remain; each task includes concrete file paths, code, and verification commands.
- Type consistency: this plan consistently uses `TerminalSessionSummary`, session lifecycle requests, `TerminalToolWindow`, and `TerminalViewport` as the new terminal surface contracts.
