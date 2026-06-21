import { createTerminalTabsStore } from "@/features/terminal/terminal-tabs-store";
import { createTerminalSessionManager } from "@/features/terminal/terminal-session-manager";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { defaultSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceSnapshot, EnvironmentReport } from "@/features/workspace/workspace-api";
import { vi } from "vitest";

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
  it("forwards terminal keystrokes to the active session writer", async () => {
    const user = userEvent.setup();
    const writeTerminalInput = vi.fn(async () => undefined);

    render(<AppShell workspaceApi={createWorkspaceApi({ writeTerminalInput })} />);
    await user.keyboard("{Alt>}{F12}{/Alt}");
    await user.click(await screen.findByLabelText("Terminal Viewport"));
    await user.keyboard("pwd{Enter}");

    expect(writeTerminalInput).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        data: expect.stringContaining("pwd"),
      }),
    );
  });
});
