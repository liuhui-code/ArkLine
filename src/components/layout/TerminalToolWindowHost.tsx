import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TerminalToolWindow } from "@/components/layout/TerminalToolWindow";
import { createTerminalOutputController, type TerminalViewportHandle } from "@/features/terminal/terminal-output-controller";
import type { TerminalSessionSummary } from "@/features/terminal/terminal-types";
import type { WorkspaceApi, TerminalSessionSummary as WorkspaceTerminalSessionSummary } from "@/features/workspace/workspace-api";

type TerminalToolWindowHostProps = {
  active: boolean;
  onStatusChange: (status: string) => void;
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
};

export function TerminalToolWindowHost({
  active,
  onStatusChange,
  workspaceApi,
  workspaceRootPath,
}: TerminalToolWindowHostProps) {
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const controllerRef = useRef(createTerminalOutputController());
  const viewportRef = useRef<TerminalViewportHandle | null>(null);

  useEffect(() => {
    if (viewportRef.current) {
      controllerRef.current.attachViewport(viewportRef.current);
    }

    return () => {
      controllerRef.current.detachViewport();
    };
  }, []);

  useEffect(() => {
    controllerRef.current.activateSession(activeSessionId);
  }, [activeSessionId]);

  useEffect(() => {
    setSessions([]);
    setActiveSessionId(null);
    controllerRef.current.activateSession(null);
  }, [workspaceRootPath]);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    let disposed = false;
    let teardown: () => void = () => {};

    void (async () => {
      const unlisten = await listen<{ sessionId: string; data: string }>("terminal-output", (event) => {
        controllerRef.current.handleOutput(event.payload.sessionId, event.payload.data);
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

  const createSession = useCallback(async () => {
    const session: WorkspaceTerminalSessionSummary = await workspaceApi.createTerminalSession({ cwd: workspaceRootPath });
    setSessions((items) => [...items.filter((item) => item.id !== session.id), session]);
    setActiveSessionId(session.id);
    setFocusToken((token) => token + 1);
  }, [workspaceApi, workspaceRootPath]);

  const ensureSession = useCallback(async () => {
    if (activeSessionId) {
      setFocusToken((token) => token + 1);
      controllerRef.current.activateSession(activeSessionId);
      return;
    }

    await createSession();
  }, [activeSessionId, createSession]);

  useEffect(() => {
    if (!active) {
      return;
    }

    void ensureSession();
  }, [active, ensureSession]);

  const setActiveSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setFocusToken((token) => token + 1);
  }, []);

  const closeSession = useCallback(async (sessionId: string) => {
    await workspaceApi.closeTerminalSession(sessionId);
    controllerRef.current.disposeSession(sessionId);
    setSessions((items) => {
      const next = items.filter((item) => item.id !== sessionId);
      setActiveSessionId((current) => {
        if (current !== sessionId) {
          return current;
        }
        return next.at(-1)?.id ?? null;
      });
      return next;
    });
    setFocusToken((token) => token + 1);
  }, [workspaceApi]);

  const clearSession = useCallback(() => {
    onStatusChange("Terminal cleared");
    if (!activeSessionId) {
      return;
    }

    controllerRef.current.clearSession(activeSessionId);
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

  const terminalToolWindow = useMemo(() => (
    <TerminalToolWindow
      sessions={sessions}
      activeSessionId={activeSessionId}
      focusToken={focusToken}
      onInput={(data) => void writeInput(data)}
      onCreateSession={() => void createSession()}
      onCloseSession={(sessionId) => void closeSession(sessionId)}
      onSetActiveSession={setActiveSession}
      onClearSession={clearSession}
      onStopSession={() => void stopSession()}
      viewportRef={viewportRef}
    />
  ), [activeSessionId, clearSession, closeSession, createSession, focusToken, sessions, setActiveSession, stopSession, writeInput]);

  return terminalToolWindow;
}
