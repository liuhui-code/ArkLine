import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { TerminalSessionSummary } from "@/features/terminal/terminal-types";
import type { WorkspaceApi, TerminalSessionSummary as WorkspaceTerminalSessionSummary } from "@/features/workspace/workspace-api";

type UseTerminalToolWindowOptions = {
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
  onStatusChange: (status: string) => void;
};

export function useTerminalToolWindow({
  workspaceApi,
  workspaceRootPath,
  onStatusChange,
}: UseTerminalToolWindowOptions) {
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const [outputBySession, setOutputBySession] = useState<Record<string, string>>({});

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let disposed = false;
    let teardown: () => void = () => {};

    void (async () => {
      const unlisten = await listen<{ sessionId: string; data: string }>("terminal-output", (event) => {
        setOutputBySession((current) => ({
          ...current,
          [event.payload.sessionId]: `${current[event.payload.sessionId] ?? ""}${event.payload.data}`,
        }));
      });

      if (disposed) {
        unlisten();
        return;
      }

      teardown = unlisten;
    })();

    return () => {
      disposed = true;
      teardown();
    };
  }, []);

  async function createSession() {
    const session: WorkspaceTerminalSessionSummary = await workspaceApi.createTerminalSession({ cwd: workspaceRootPath });
    setSessions((items) => [...items.filter((item) => item.id !== session.id), session]);
    setActiveSessionId(session.id);
    setOutputBySession((current) => ({ ...current, [session.id]: "" }));
    setFocusToken((token) => token + 1);
  }

  async function ensureSession() {
    if (activeSessionId) {
      setFocusToken((token) => token + 1);
      return;
    }

    await createSession();
  }

  function setActiveSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setFocusToken((token) => token + 1);
  }

  async function closeSession(sessionId: string) {
    await workspaceApi.closeTerminalSession(sessionId);
    const next = sessions.filter((item) => item.id !== sessionId);
    setSessions(next);
    setActiveSessionId(next.at(-1)?.id ?? null);
    setFocusToken((token) => token + 1);
  }

  function clearSession() {
    onStatusChange("Terminal cleared");
    if (activeSessionId) {
      setOutputBySession((current) => ({ ...current, [activeSessionId]: "" }));
    }
    setFocusToken((token) => token + 1);
  }

  async function stopSession() {
    if (!activeSessionId) {
      return;
    }

    await workspaceApi.stopTerminalSession(activeSessionId);
    onStatusChange("Terminal stop requested");
  }

  async function writeInput(data: string) {
    if (!activeSessionId) {
      return;
    }

    await workspaceApi.writeTerminalInput({
      sessionId: activeSessionId,
      data,
    });
  }

  function resetSessions() {
    setSessions([]);
    setActiveSessionId(null);
  }

  return {
    sessions,
    activeSessionId,
    focusToken,
    outputBySession,
    createSession,
    ensureSession,
    setActiveSession,
    closeSession,
    clearSession,
    stopSession,
    writeInput,
    resetSessions,
  };
}
