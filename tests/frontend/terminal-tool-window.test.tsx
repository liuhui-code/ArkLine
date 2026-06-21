import { createTerminalTabsStore } from "@/features/terminal/terminal-tabs-store";
import { createTerminalSessionManager } from "@/features/terminal/terminal-session-manager";

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
