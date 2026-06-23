export type TerminalViewportHandle = {
  clear(): void;
  focus(): void;
  reset(output: string): void;
  write(data: string): void;
};

export function createTerminalOutputController() {
  const outputBySession = new Map<string, string>();
  let activeSessionId: string | null = null;
  let viewport: TerminalViewportHandle | null = null;

  function append(sessionId: string, data: string) {
    outputBySession.set(sessionId, `${outputBySession.get(sessionId) ?? ""}${data}`);
  }

  return {
    attachViewport(nextViewport: TerminalViewportHandle) {
      viewport = nextViewport;
      nextViewport.reset(activeSessionId ? outputBySession.get(activeSessionId) ?? "" : "");
    },
    detachViewport() {
      viewport = null;
    },
    activateSession(sessionId: string | null) {
      activeSessionId = sessionId;
      if (!viewport) {
        return;
      }

      viewport.reset(sessionId ? outputBySession.get(sessionId) ?? "" : "");
      if (sessionId) {
        viewport.focus();
      }
    },
    handleOutput(sessionId: string, data: string) {
      append(sessionId, data);
      if (viewport && activeSessionId === sessionId) {
        viewport.write(data);
      }
    },
    clearSession(sessionId: string) {
      outputBySession.set(sessionId, "");
      if (viewport && activeSessionId === sessionId) {
        viewport.clear();
      }
    },
    disposeSession(sessionId: string) {
      outputBySession.delete(sessionId);
      if (activeSessionId === sessionId) {
        activeSessionId = null;
        viewport?.reset("");
      }
    },
    getBufferedOutput(sessionId: string) {
      return outputBySession.get(sessionId) ?? "";
    },
  };
}
