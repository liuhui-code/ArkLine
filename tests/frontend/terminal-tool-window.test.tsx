import { createTerminalTabsStore } from "@/features/terminal/terminal-tabs-store";
import { createTerminalSessionManager } from "@/features/terminal/terminal-session-manager";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { TerminalToolWindowHost } from "@/components/layout/TerminalToolWindowHost";
import { TerminalViewport } from "@/components/layout/TerminalViewport";
import type { TerminalViewportHandle } from "@/features/terminal/terminal-output-controller";
import { defaultSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceSnapshot, EnvironmentReport } from "@/features/workspace/workspace-api";
import { act, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, vi } from "vitest";

const terminalInstances: FakeTerminal[] = [];

class FakeTerminal {
  writes: string[] = [];
  focus = vi.fn();
  clear = vi.fn();
  onDataCallback: ((data: string) => void) | null = null;
  element: HTMLElement | null = null;
  keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  constructor(_options?: unknown) {
    terminalInstances.push(this);
  }

  write(data: string) {
    this.writes.push(data);
  }

  reset() {
    this.writes = [];
  }

  dispose() {
    if (this.element && this.keydownHandler) {
      this.element.removeEventListener("keydown", this.keydownHandler);
    }
  }

  open(element: HTMLElement) {
    this.element = element;
    this.keydownHandler = (event: KeyboardEvent) => {
      if (!this.onDataCallback) {
        return;
      }

      if (event.key === "Enter") {
        this.onDataCallback("\r");
        return;
      }

      if (event.key === "Backspace") {
        this.onDataCallback("\u007f");
        return;
      }

      if (event.key.length === 1) {
        this.onDataCallback(event.key);
      }
    };
    element.addEventListener("keydown", this.keydownHandler);
  }

  loadAddon(_addon: { fit(): void }) {}

  onData(callback: (data: string) => void) {
    this.onDataCallback = callback;
    return { dispose() {} };
  }
}

const fitAddonFit = vi.fn();

vi.mock("@xterm/xterm", () => ({
  Terminal: FakeTerminal,
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {
      fitAddonFit();
    }
  },
}));

beforeEach(() => {
  terminalInstances.length = 0;
  fitAddonFit.mockClear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

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
    expect(writes).toEqual(["subscribed"]);
  });
});

function createWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    rootName: "ArkDemo",
    rootPath: "C:/samples/ArkDemo",
    files: ["C:/samples/ArkDemo/entry/src/main/ets/pages/Index.ets"],
  };
}

function createEnvironmentReport(): EnvironmentReport {
  return { tools: [] };
}

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => null,
    openWorkspace: async () => createWorkspaceSnapshot(),
    openDemoWorkspace: async () => createWorkspaceSnapshot(),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => createEnvironmentReport(),
    inspectLanguageService: async () => ({
      provider: "mock-fallback",
      mode: "fallback",
      running: true,
      hover: true,
      definition: true,
      completion: true,
      documentSymbols: true,
      findUsages: true,
      detail: "Mock fallback ArkTS language service for demo and integration-shell wiring",
    }),
    hoverSymbol: async () => null,
    gotoDefinition: async () => null,
    completeSymbol: async () => [],
    documentSymbols: async () => [],
    findUsages: async () => [],
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
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
    runTerminalCommand: async () => ({ runId: "run-1", command: "", stdout: "", stderr: "", exitCode: 0, durationMs: 0, stopped: false }),
    stopTerminalCommand: async () => undefined,
    ...overrides,
  };
}

describe("terminal tool window", () => {
  it("replays buffered output through xterm after async terminal startup", async () => {
    const ansiOutput = "\u001b[31merror\u001b[0m";
    const viewportRef = createRef<TerminalViewportHandle>();

    render(
      <TerminalViewport
        ref={viewportRef}
        focusToken={0}
        layoutToken={0}
        onInput={() => undefined}
        sessionId="session-1"
      />,
    );

    viewportRef.current?.reset(ansiOutput);
    await waitFor(() => expect(terminalInstances).toHaveLength(1));
    expect(terminalInstances[0]?.writes).toContain(ansiOutput);
    expect(screen.getByLabelText("Terminal Viewport").textContent).toBe("");
  });

  it("focuses the xterm instance when the terminal session becomes active", async () => {
    const { rerender } = render(
      <TerminalViewport
        focusToken={0}
        layoutToken={0}
        onInput={() => undefined}
        sessionId="session-1"
      />,
    );

    await waitFor(() => expect(terminalInstances).toHaveLength(1));
    const terminal = terminalInstances[0];

    await act(async () => {
      rerender(
        <TerminalViewport
          focusToken={1}
          layoutToken={0}
          onInput={() => undefined}
          sessionId="session-1"
        />,
      );
    });

    expect(terminal?.focus).toHaveBeenCalled();
  });

  it("refits xterm when the terminal layout token changes", async () => {
    const onInput = vi.fn();
    const { rerender } = render(
      <TerminalViewport
        focusToken={0}
        layoutToken={1}
        onInput={onInput}
        sessionId="session-1"
      />,
    );

    await waitFor(() => expect(terminalInstances).toHaveLength(1));
    const initialFitCount = fitAddonFit.mock.calls.length;

    await act(async () => {
      rerender(
        <TerminalViewport
          focusToken={0}
          layoutToken={2}
          onInput={onInput}
          sessionId="session-1"
        />,
      );
    });

    expect(fitAddonFit.mock.calls.length).toBeGreaterThan(initialFitCount);
  });

  it("refits the hosted terminal without recreating xterm when layout changes", async () => {
    const workspaceApi = createWorkspaceApi();
    const onStatusChange = vi.fn();
    const { rerender } = render(
      <TerminalToolWindowHost
        active
        layoutToken={1}
        onStatusChange={onStatusChange}
        workspaceApi={workspaceApi}
        workspaceRootPath="C:/samples/DemoWorkspace"
      />,
    );

    await waitFor(() => expect(terminalInstances).toHaveLength(1));
    const initialFitCount = fitAddonFit.mock.calls.length;

    await act(async () => {
      rerender(
        <TerminalToolWindowHost
          active
          layoutToken={2}
          onStatusChange={onStatusChange}
          workspaceApi={workspaceApi}
          workspaceRootPath="C:/samples/DemoWorkspace"
        />,
      );
    });

    expect(terminalInstances).toHaveLength(1);
    expect(fitAddonFit.mock.calls.length).toBeGreaterThan(initialFitCount);
  });

  it("forwards terminal keystrokes to the active session writer", async () => {
    const user = userEvent.setup();
    const writeTerminalInput = vi.fn(async () => undefined);

    render(<AppShell workspaceApi={createWorkspaceApi({ writeTerminalInput })} />);
    await user.keyboard("{Alt>}{F12}{/Alt}");
    await user.click(await screen.findByLabelText("Terminal Viewport"));
    await user.keyboard("pwd{Enter}");

    expect(writeTerminalInput).toHaveBeenNthCalledWith(1, { sessionId: "session-1", data: "p" });
    expect(writeTerminalInput).toHaveBeenNthCalledWith(2, { sessionId: "session-1", data: "w" });
    expect(writeTerminalInput).toHaveBeenNthCalledWith(3, { sessionId: "session-1", data: "d" });
    expect(writeTerminalInput).toHaveBeenNthCalledWith(4, { sessionId: "session-1", data: "\r" });
  });
});
