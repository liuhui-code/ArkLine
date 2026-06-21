import { useState } from "react";
import type { TerminalSessionSummary } from "@/features/terminal/terminal-types";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

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

  async function createSession() {
    const session = await workspaceApi.createTerminalSession({ cwd: workspaceRootPath });
    setSessions((items) => [...items.filter((item) => item.id !== session.id), session]);
    setActiveSessionId(session.id);
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
    setFocusToken((token) => token + 1);
  }

  async function stopSession() {
    if (!activeSessionId) {
      return;
    }

    await workspaceApi.stopTerminalSession(activeSessionId);
    onStatusChange("Terminal stop requested");
  }

  function resetSessions() {
    setSessions([]);
    setActiveSessionId(null);
  }

  return {
    sessions,
    activeSessionId,
    focusToken,
    createSession,
    ensureSession,
    setActiveSession,
    closeSession,
    clearSession,
    stopSession,
    resetSessions,
  };
}
