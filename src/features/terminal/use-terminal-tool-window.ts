import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const pendingOutputRef = useRef<Record<string, string>>({});
  const flushFrameRef = useRef<number | null>(null);

  const flushPendingOutput = useCallback(() => {
    flushFrameRef.current = null;
    const pending = pendingOutputRef.current;
    pendingOutputRef.current = {};
    if (Object.keys(pending).length === 0) {
      return;
    }

    setOutputBySession((current) => {
      const next = { ...current };
      for (const [sessionId, data] of Object.entries(pending)) {
        next[sessionId] = `${next[sessionId] ?? ""}${data}`;
      }
      return next;
    });
  }, []);

  const scheduleOutputFlush = useCallback(() => {
    if (flushFrameRef.current !== null) {
      return;
    }

    flushFrameRef.current = window.requestAnimationFrame(() => {
      flushPendingOutput();
    });
  }, [flushPendingOutput]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let disposed = false;
    let teardown: () => void = () => {};

    void (async () => {
      const unlisten = await listen<{ sessionId: string; data: string }>("terminal-output", (event) => {
        pendingOutputRef.current[event.payload.sessionId] = `${pendingOutputRef.current[event.payload.sessionId] ?? ""}${event.payload.data}`;
        scheduleOutputFlush();
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
      if (flushFrameRef.current !== null) {
        window.cancelAnimationFrame(flushFrameRef.current);
      }
    };
  }, [scheduleOutputFlush]);

  useEffect(() => {
    setSessions([]);
    setActiveSessionId(null);
    setOutputBySession({});
    pendingOutputRef.current = {};
  }, [workspaceRootPath]);

  const createSession = useCallback(async () => {
    const session: WorkspaceTerminalSessionSummary = await workspaceApi.createTerminalSession({ cwd: workspaceRootPath });
    setSessions((items) => [...items.filter((item) => item.id !== session.id), session]);
    setActiveSessionId(session.id);
    setOutputBySession((current) => ({ ...current, [session.id]: "" }));
    setFocusToken((token) => token + 1);
  }, [workspaceApi, workspaceRootPath]);

  const ensureSession = useCallback(async () => {
    if (activeSessionId) {
      setFocusToken((token) => token + 1);
      return;
    }

    await createSession();
  }, [activeSessionId, createSession]);

  const setActiveSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setFocusToken((token) => token + 1);
  }, []);

  const closeSession = useCallback(async (sessionId: string) => {
    await workspaceApi.closeTerminalSession(sessionId);
    setSessions((items) => {
      const next = items.filter((item) => item.id !== sessionId);
      setActiveSessionId(next.at(-1)?.id ?? null);
      return next;
    });
    setFocusToken((token) => token + 1);
  }, [workspaceApi]);

  const clearSession = useCallback(() => {
    onStatusChange("Terminal cleared");
    if (activeSessionId) {
      setOutputBySession((current) => ({ ...current, [activeSessionId]: "" }));
    }
    setFocusToken((token) => token + 1);
  }, [activeSessionId, onStatusChange]);

  const stopSession = useCallback(async () => {
    if (!activeSessionId) {
      return;
    }

    await workspaceApi.stopTerminalSession(activeSessionId);
    onStatusChange("Terminal stop requested");
  }, [activeSessionId, onStatusChange, workspaceApi]);

  const writeInput = useCallback(async (data: string) => {
    if (!activeSessionId) {
      return;
    }

    await workspaceApi.writeTerminalInput({
      sessionId: activeSessionId,
      data,
    });
  }, [activeSessionId, workspaceApi]);

  const resetSessions = useCallback(() => {
    setSessions([]);
    setActiveSessionId(null);
  }, []);

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
