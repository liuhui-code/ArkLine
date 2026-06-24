import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { TerminalToolWindow } from "@/components/layout/TerminalToolWindow";
import { createTerminalOutputController, type TerminalViewportHandle } from "@/features/terminal/terminal-output-controller";
import type { TerminalSessionSummary } from "@/features/terminal/terminal-types";
import type { WorkspaceApi, TerminalSessionSummary as WorkspaceTerminalSessionSummary } from "@/features/workspace/workspace-api";

type TerminalToolWindowHostProps = {
  active: boolean;
  layoutToken: number;
  onStatusChange: (status: string) => void;
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
};

export function TerminalToolWindowHost({
  active,
  layoutToken,
  onStatusChange,
  workspaceApi,
  workspaceRootPath,
}: TerminalToolWindowHostProps) {
  const [sessions, setSessions] = useState<TerminalSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [focusToken, setFocusToken] = useState(0);
  const controllerRef = useRef(createTerminalOutputController());
  const viewportRef = useMemo<RefObject<TerminalViewportHandle | null>>(() => {
    let current: TerminalViewportHandle | null = null;

    return {
      get current() {
        return current;
      },
      set current(nextViewport) {
        current = nextViewport;
        if (nextViewport) {
          controllerRef.current.attachViewport(nextViewport);
          return;
        }

        controllerRef.current.detachViewport();
      },
    };
  }, []);
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

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
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) {
      return;
    }

    await workspaceApi.writeTerminalInput({
      sessionId,
      data,
    });
  }, [workspaceApi]);

  const handleInput = useCallback((data: string) => {
    void writeInput(data);
  }, [writeInput]);

  const terminalToolWindow = useMemo(() => {
    if (!activeSessionId && sessions.length === 0) {
      return null;
    }

    return (
      <TerminalToolWindow
        sessions={sessions}
        activeSessionId={activeSessionId}
        focusToken={focusToken}
        layoutToken={layoutToken}
        onInput={handleInput}
        onCreateSession={() => void createSession()}
        onCloseSession={(sessionId) => void closeSession(sessionId)}
        onSetActiveSession={setActiveSession}
        onClearSession={clearSession}
        onStopSession={() => void stopSession()}
        viewportRef={viewportRef}
      />
    );
  }, [activeSessionId, clearSession, closeSession, createSession, focusToken, handleInput, layoutToken, sessions, setActiveSession, stopSession]);

  return terminalToolWindow;
}
