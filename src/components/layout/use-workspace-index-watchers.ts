import { useEffect, useSyncExternalStore } from "react";
import { WORKSPACE_INDEX_WATCH_INTERVAL_MS } from "@/components/layout/app-shell-constants";
import { workspaceIndexProjectionStore } from "@/features/workspace/workspace-index-projection-store";
import type {
  WorkspaceApi,
  WorkspaceIndexEvent,
  WorkspaceIndexRefreshResult,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";

export type UseWorkspaceIndexWatchersOptions = {
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  applyWorkspaceIndexRefreshResult: (result: WorkspaceIndexRefreshResult) => void;
  refreshWorkspaceIndexTaskStatuses: (rootPath: string) => Promise<void>;
  recordWorkspaceIndexTaskStatus: (status: WorkspaceIndexTaskStatus) => void;
  onStatusChange: (message: string) => void;
};

export function useWorkspaceIndexWatchers({
  rootPath,
  workspaceApi,
  applyWorkspaceIndexRefreshResult,
  refreshWorkspaceIndexTaskStatuses,
  recordWorkspaceIndexTaskStatus,
  onStatusChange,
}: UseWorkspaceIndexWatchersOptions) {
  const indexProjection = useSyncExternalStore(
    workspaceIndexProjectionStore.subscribe,
    workspaceIndexProjectionStore.snapshot,
    workspaceIndexProjectionStore.snapshot,
  );

  useEffect(() => {
    const result = indexProjection.refreshResult;
    if (!rootPath || indexProjection.rootPath !== rootPath || !result?.changed) {
      return;
    }

    applyWorkspaceIndexRefreshResult(result);
    onStatusChange(`Workspace index refreshed: +${result.addedPaths.length} -${result.removedPaths.length}`);
  }, [rootPath, indexProjection.refreshEventCount]);

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
    const watchedRootPath = rootPath;
    let teardownWatcher: (() => void) | null = null;
    void refreshWorkspaceIndexTaskStatuses(watchedRootPath);
    void workspaceApi.watchWorkspaceIndexTaskStatuses(watchedRootPath, (status) => {
      if (disposed) {
        return;
      }

      recordWorkspaceIndexTaskStatus(status);
    })
      .then((teardown) => {
        if (disposed) {
          teardown();
          return;
        }

        teardownWatcher = teardown;
      })
      .catch((error) => {
        if (!disposed) {
          onStatusChange(`Workspace index status watcher failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      });

    return () => {
      disposed = true;
      teardownWatcher?.();
    };
  }, [rootPath, workspaceApi]);
}
