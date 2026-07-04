import { useEffect } from "react";
import { LAZY_PROJECT_TREE_FILE_THRESHOLD } from "@/components/layout/app-shell-constants";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { toWorkspaceViewModel } from "@/features/workspace/workspace-api";

export type UseWorkspaceOpeningControllerOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceApi: WorkspaceApi;
  applyWorkspaceSessionSnapshot: (snapshot: WorkspaceViewModel) => void;
  resetProjectTree: () => void;
  loadProjectDirectory: (rootPath: string, directoryPath: string) => Promise<void>;
  loadProjectDirectoryForWorkspace: (workspace: WorkspaceViewModel | null, path: string) => void;
  resetWorkspaceUi: (workspaceName: string) => void;
  loadBuildConfigurationsForRoot: (rootPath: string) => Promise<void>;
  refreshSemanticState: () => Promise<void>;
  setProjectPathInput: (rootPath: string) => void;
  setProjectOpenError: (message: string | null) => void;
  onStatusChange: (message: string) => void;
};

export function useWorkspaceOpeningController({
  workspace,
  workspaceApi,
  applyWorkspaceSessionSnapshot,
  resetProjectTree,
  loadProjectDirectory,
  loadProjectDirectoryForWorkspace,
  resetWorkspaceUi,
  loadBuildConfigurationsForRoot,
  refreshSemanticState,
  setProjectPathInput,
  setProjectOpenError,
  onStatusChange,
}: UseWorkspaceOpeningControllerOptions) {
  function applyWorkspaceSnapshot(snapshot: WorkspaceViewModel) {
    applyWorkspaceSessionSnapshot(snapshot);
    resetProjectTree();
    if (snapshot.scanSummary.truncated || snapshot.visibleFiles.length >= LAZY_PROJECT_TREE_FILE_THRESHOLD) {
      void loadProjectDirectory(snapshot.rootPath, snapshot.rootPath);
    }
  }

  function loadProjectDirectoryForActiveWorkspace(path: string) {
    loadProjectDirectoryForWorkspace(workspace, path);
  }

  async function openWorkspace(rootPath: string) {
    try {
      const snapshot = await workspaceApi.openWorkspace(rootPath);
      applyWorkspaceSnapshot(toWorkspaceViewModel(snapshot));
      resetWorkspaceUi(snapshot.rootName);
      await loadBuildConfigurationsForRoot(snapshot.rootPath);
      await refreshSemanticState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setProjectPathInput(rootPath);
      setProjectOpenError(message);
      onStatusChange(`Open Project failed: ${message}`);
    }
  }

  async function openDemoWorkspace() {
    const snapshot = await workspaceApi.openDemoWorkspace();
    applyWorkspaceSnapshot(toWorkspaceViewModel(snapshot));
    resetWorkspaceUi(snapshot.rootName);
  }

  useEffect(() => {
    let disposed = false;
    if (workspace) {
      return;
    }
    void (async () => {
      const launchRootPath = await workspaceApi.getLaunchWorkspacePath?.();
      if (!launchRootPath || disposed) {
        return;
      }
      await openWorkspace(launchRootPath);
    })();
    return () => {
      disposed = true;
    };
  }, [workspace, workspaceApi]);

  return {
    openWorkspace,
    openDemoWorkspace,
    loadProjectDirectoryForActiveWorkspace,
  };
}
