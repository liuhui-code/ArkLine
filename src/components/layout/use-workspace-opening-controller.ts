import { useEffect, useRef } from "react";
import { LAZY_PROJECT_TREE_FILE_THRESHOLD } from "@/components/layout/app-shell-constants";
import type { AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { toWorkspaceViewModel } from "@/features/workspace/workspace-api";

export type UseWorkspaceOpeningControllerOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceApi: WorkspaceApi;
  settingsHydrated: boolean;
  recentProjects: string[];
  getWorkspaceSessions: () => AppSettings["workspaceSessions"];
  applyWorkspaceSessionSnapshot: (snapshot: WorkspaceViewModel) => void;
  openFile: (path: string) => Promise<void>;
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
  settingsHydrated,
  recentProjects,
  getWorkspaceSessions,
  applyWorkspaceSessionSnapshot,
  openFile,
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
  const autoRestoreAttemptedRef = useRef(false);

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
      await restoreLastActiveFile(snapshot.rootPath);
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
    await restoreLastActiveFile(snapshot.rootPath);
  }

  async function restoreLastActiveFile(rootPath: string) {
    const workspaceSessions = getWorkspaceSessions();
    const activeFilePath = workspaceSessions[rootPath]?.activeFilePath;
    if (!activeFilePath) return;
    try {
      await openFile(activeFilePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Last file unavailable: ${message}`);
    }
  }

  useEffect(() => {
    let disposed = false;
    if (workspace || autoRestoreAttemptedRef.current || !settingsHydrated) {
      return;
    }
    void (async () => {
      const launchRootPath = await workspaceApi.getLaunchWorkspacePath?.();
      const restoreRootPath = launchRootPath || recentProjects[0];
      if (!restoreRootPath || disposed) {
        return;
      }
      autoRestoreAttemptedRef.current = true;
      await openWorkspace(restoreRootPath);
    })();
    return () => {
      disposed = true;
    };
  }, [recentProjects, settingsHydrated, workspace, workspaceApi, getWorkspaceSessions]);

  return {
    openWorkspace,
    openDemoWorkspace,
    loadProjectDirectoryForActiveWorkspace,
  };
}
