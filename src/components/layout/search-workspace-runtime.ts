import {
  createSearchInteractionRuntime,
} from "@/features/search/search-interaction-runtime";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

export type WorkspaceSearchInteractionRuntimeOptions = {
  getRootPath: () => string | null;
  getWorkspaceApi: () => Pick<WorkspaceApi, "cancelWorkspaceSearch">;
  onError?: (error: unknown) => void;
};

export function createWorkspaceSearchInteractionRuntime({
  getRootPath,
  getWorkspaceApi,
  onError,
}: WorkspaceSearchInteractionRuntimeOptions) {
  return createSearchInteractionRuntime({
    cancel: (kind, generation) => {
      const rootPath = getRootPath();
      const workspaceApi = getWorkspaceApi();
      if (!rootPath || !workspaceApi.cancelWorkspaceSearch) return;
      void workspaceApi.cancelWorkspaceSearch(rootPath, kind, generation).catch(() => undefined);
    },
    onError,
  });
}
