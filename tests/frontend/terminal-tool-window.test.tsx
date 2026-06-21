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
