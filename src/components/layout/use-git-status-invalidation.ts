import { useEffect } from "react";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

const GIT_CHANGE_DEBOUNCE_MS = 250;
const GIT_FALLBACK_POLL_MS = 60_000;

type UseGitStatusInvalidationOptions = {
  active: boolean;
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  onInvalidate: () => void;
};

export function useGitStatusInvalidation({
  active,
  rootPath,
  workspaceApi,
  onInvalidate,
}: UseGitStatusInvalidationOptions) {
  useEffect(() => {
    if (!active || !rootPath) return;

    let disposed = false;
    let teardownWatcher: (() => void) | null = null;
    let debounceTimer: number | null = null;
    let fallbackInterval: number | null = null;

    function scheduleRefresh(delayMs: number) {
      if (disposed || document.visibilityState !== "visible") return;
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        if (!disposed) onInvalidate();
      }, delayMs);
    }

    function startFallbackPolling() {
      if (disposed || fallbackInterval !== null) return;
      fallbackInterval = window.setInterval(() => scheduleRefresh(0), GIT_FALLBACK_POLL_MS);
    }

    const refreshOnFocus = () => scheduleRefresh(0);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") scheduleRefresh(0);
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    if (workspaceApi.watchWorkspaceFileChanges) {
      void workspaceApi.watchWorkspaceFileChanges(rootPath, () => {
        scheduleRefresh(GIT_CHANGE_DEBOUNCE_MS);
      }).then((teardown) => {
        if (disposed) teardown();
        else teardownWatcher = teardown;
      }).catch(startFallbackPolling);
    }
    startFallbackPolling();

    return () => {
      disposed = true;
      teardownWatcher?.();
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      if (fallbackInterval !== null) window.clearInterval(fallbackInterval);
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [active, onInvalidate, rootPath, workspaceApi]);
}
