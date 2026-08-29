import { useEffect, useRef } from "react";
import { WORKSPACE_INDEX_WATCH_INTERVAL_MS } from "@/components/layout/app-shell-constants";
import { isTerminalProjectIndexTaskStatus } from "@/components/layout/index-diagnostics-controller-model";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type {
  WorkspaceApi,
  WorkspaceIndexEvent,
  WorkspaceIndexRefreshResult,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";

const TASK_STATUS_WATCH_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000];

export type UseWorkspaceIndexWatchersOptions = {
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  applyWorkspaceIndexRefreshResult: (result: WorkspaceIndexRefreshResult) => void;
  applyWorkspaceIndexState?: (state: WorkspaceIndexState) => void;
  refreshWorkspaceIndexTaskStatuses: (rootPath: string) => Promise<void>;
  recordWorkspaceIndexTaskStatus: (status: WorkspaceIndexTaskStatus) => void;
  onStatusChange: (message: string) => void;
};

export function useWorkspaceIndexWatchers({
  rootPath,
  workspaceApi,
  applyWorkspaceIndexRefreshResult,
  applyWorkspaceIndexState,
  refreshWorkspaceIndexTaskStatuses,
  recordWorkspaceIndexTaskStatus,
  onStatusChange,
}: UseWorkspaceIndexWatchersOptions) {
  const appliedRefreshEventRef = useRef(0);
  const applyWorkspaceIndexRefreshResultRef = useRef(applyWorkspaceIndexRefreshResult);
  const applyWorkspaceIndexStateRef = useRef(applyWorkspaceIndexState);
  const onStatusChangeRef = useRef(onStatusChange);
  applyWorkspaceIndexRefreshResultRef.current = applyWorkspaceIndexRefreshResult;
  applyWorkspaceIndexStateRef.current = applyWorkspaceIndexState;
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    function applyLatestRefreshResult() {
      const indexProjection = workspaceIndexProjectionStore.snapshot();
      const result = indexProjection.refreshResult;
      if (
        !rootPath
        || indexProjection.rootPath !== rootPath
        || !result?.changed
        || appliedRefreshEventRef.current === indexProjection.refreshEventCount
      ) {
        return;
      }
      appliedRefreshEventRef.current = indexProjection.refreshEventCount;
      applyWorkspaceIndexRefreshResultRef.current(result);
      onStatusChangeRef.current(`Workspace index refreshed: +${result.addedPaths.length} -${result.removedPaths.length}`);
    }

    appliedRefreshEventRef.current = 0;
    applyLatestRefreshResult();
    return workspaceIndexProjectionStore.subscribe(applyLatestRefreshResult);
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      return;
    }

    let disposed = false;
    let inFlight = false;
    const watchedRootPath = rootPath;
    let teardownWatcher: (() => void) | null = null;

    function applyWatchedWorkspaceIndex(result: WorkspaceIndexRefreshResult) {
      if (disposed || !result.changed) {
        return;
      }

      workspaceIndexProjectionStore.recordRefreshResult(watchedRootPath, result);
    }

    async function pollWorkspaceIndex() {
      if (!workspaceApi.refreshWorkspaceIndexWithChanges || inFlight) {
        return;
      }

      inFlight = true;
      try {
        const result = await workspaceApi.refreshWorkspaceIndexWithChanges(watchedRootPath);
        if (!result || disposed || !result.changed) {
          return;
        }

        workspaceIndexProjectionStore.recordRefreshResult(watchedRootPath, result);
      } catch (error) {
        if (!disposed) {
          onStatusChange(`Workspace index refresh failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      } finally {
        inFlight = false;
      }
    }

    if (workspaceApi.watchWorkspaceIndex) {
      void workspaceApi.watchWorkspaceIndex(watchedRootPath, applyWatchedWorkspaceIndex)
        .then((teardown) => {
          if (disposed) {
            teardown();
            return;
          }

          teardownWatcher = teardown;
        })
        .catch((error) => {
          if (!disposed) {
            onStatusChange(`Workspace index watcher failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        });

      return () => {
        disposed = true;
        teardownWatcher?.();
      };
    }

    if (!workspaceApi.refreshWorkspaceIndexWithChanges) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void pollWorkspaceIndex();
    }, WORKSPACE_INDEX_WATCH_INTERVAL_MS);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [rootPath, workspaceApi]);

  useEffect(() => {
    if (!rootPath || !workspaceApi.watchWorkspaceIndexEvents) {
      return;
    }

    let disposed = false;
    const watchedRootPath = rootPath;
    let teardownWatcher: (() => void) | null = null;
    function recordWorkspaceIndexEvent(event: WorkspaceIndexEvent) {
      if (disposed) {
        return;
      }

      workspaceIndexProjectionStore.recordRecentEvent(watchedRootPath, event);
    }

    void workspaceApi.watchWorkspaceIndexEvents(watchedRootPath, recordWorkspaceIndexEvent)
      .then((teardown) => {
        if (disposed) {
          teardown();
          return;
        }

        teardownWatcher = teardown;
      })
      .catch((error) => {
        if (!disposed) {
          onStatusChange(`Workspace index event watcher failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

    return () => {
      disposed = true;
      teardownWatcher?.();
    };
  }, [rootPath, workspaceApi]);

  useEffect(() => {
    if (!rootPath || !workspaceApi.watchWorkspaceIndexTaskStatuses) {
      return;
    }

    let disposed = false;
    let stateSyncSequence = 0;
    const watchedRootPath = rootPath;
    let teardownWatcher: (() => void) | null = null;
    let retryTimer: number | null = null;
    let retryAttempt = 0;

    async function synchronizeWorkspaceIndexState() {
      if (
        !workspaceApi.getWorkspaceIndexState
        || !applyWorkspaceIndexStateRef.current
      ) {
        return;
      }

      const sequence = ++stateSyncSequence;
      try {
        const state = await workspaceApi.getWorkspaceIndexState(watchedRootPath);
        if (!disposed && sequence === stateSyncSequence) {
          applyWorkspaceIndexStateRef.current?.(state);
        }
      } catch (error) {
        if (!disposed && sequence === stateSyncSequence) {
          onStatusChangeRef.current(`Workspace index state sync failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    async function initializeTaskStatusWatcher() {
      let shouldRetry = false;
      try {
        const teardown = await workspaceApi.watchWorkspaceIndexTaskStatuses!(watchedRootPath, (status) => {
          if (disposed) {
            return;
          }

          recordWorkspaceIndexTaskStatus(status);
          if (isTerminalProjectIndexTaskStatus(status)) {
            void synchronizeWorkspaceIndexState();
          }
        });
        if (disposed) {
          teardown();
          return;
        }

        teardownWatcher = teardown;
        retryAttempt = 0;
      } catch (error) {
        shouldRetry = true;
        if (!disposed) {
          onStatusChange(`Workspace index status watcher failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (disposed) return;
      try {
        await refreshWorkspaceIndexTaskStatuses(watchedRootPath);
      } catch (error) {
        if (!disposed) {
          onStatusChange(`Workspace index status reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (!disposed) {
        await synchronizeWorkspaceIndexState();
      }
      if (!disposed && shouldRetry) {
        const delay = TASK_STATUS_WATCH_RETRY_DELAYS_MS[
          Math.min(retryAttempt, TASK_STATUS_WATCH_RETRY_DELAYS_MS.length - 1)
        ];
        retryAttempt += 1;
        retryTimer = window.setTimeout(() => {
          retryTimer = null;
          void initializeTaskStatusWatcher();
        }, delay);
      }
    }

    void initializeTaskStatusWatcher();

    return () => {
      disposed = true;
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      teardownWatcher?.();
    };
  }, [rootPath, workspaceApi]);
}
