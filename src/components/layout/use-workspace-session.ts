import { useState } from "react";
import {
  pathWithinDirectory,
  uniqueNormalizedPaths,
} from "@/components/layout/app-shell-model";
import { shouldScheduleForegroundIndex } from "@/components/layout/foreground-index-schedule-gate";
import { createFileTreeNodes } from "@/features/workspace/file-tree-store";
import type { WorkspaceApi, WorkspaceIndexRefreshResult, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { normalizePath } from "@/features/workspace/workspace-store";

export type UseWorkspaceSessionOptions = {
  workspaceApi: WorkspaceApi;
  onOpenWorkspaceIndex: (workspace: WorkspaceViewModel) => void;
  onReplaceWorkspaceIndexState: (state: WorkspaceIndexState) => void;
  onPersistRecentProjects: (recentProjects: string[]) => void;
  onStatusChange: (message: string) => void;
};

export function useWorkspaceSession({
  workspaceApi,
  onOpenWorkspaceIndex,
  onReplaceWorkspaceIndexState,
  onPersistRecentProjects,
  onStatusChange,
}: UseWorkspaceSessionOptions) {
  const [workspace, setWorkspace] = useState<WorkspaceViewModel | null>(null);
  const [recentProjects, setRecentProjects] = useState<string[]>([]);

  function syncWorkspaceIndex(nextWorkspace: WorkspaceViewModel) {
    onOpenWorkspaceIndex(nextWorkspace);
  }

  function scheduleVisibleFilesIndex(rootPath: string, visibleFiles: string[]) {
    if (!workspaceApi.scheduleVisibleFilesIndex || visibleFiles.length === 0) {
      return;
    }
    const scheduledFiles = uniqueNormalizedPaths(visibleFiles)
      .filter((path) => shouldScheduleForegroundIndex("visible", rootPath, path));
    if (scheduledFiles.length === 0) {
      return;
    }
    void workspaceApi.scheduleVisibleFilesIndex(rootPath, scheduledFiles).catch((error) => {
      onStatusChange(`Visible index scheduling failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  function applyWorkspaceIndexRefreshResult(result: WorkspaceIndexRefreshResult) {
    onReplaceWorkspaceIndexState(result.state);
    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      const visibleFiles = uniqueNormalizedPaths(result.state.filePaths);
      return {
        ...current,
        visibleFiles,
        fileTree: createFileTreeNodes(visibleFiles),
      };
    });
  }

  function applyWorkspaceSnapshot(snapshot: WorkspaceViewModel) {
    setWorkspace(snapshot);
    syncWorkspaceIndex(snapshot);
    scheduleVisibleFilesIndex(snapshot.rootPath, snapshot.visibleFiles);
    setRecentProjects((items) => {
      const next = [snapshot.rootPath, ...items.filter((item) => item !== snapshot.rootPath)].slice(0, 8);
      onPersistRecentProjects(next);
      return next;
    });
  }

  function includeVisibleWorkspaceFile(path: string) {
    if (!workspace) {
      return;
    }

    const normalizedPath = normalizePath(path);
    const normalizedRoot = normalizePath(workspace.rootPath);
    if (!pathWithinDirectory(normalizedPath, normalizedRoot)) {
      return;
    }

    const alreadyVisible = workspace.visibleFiles.some((visiblePath) => normalizePath(visiblePath) === normalizedPath);
    if (alreadyVisible) {
      return;
    }

    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      const currentRoot = normalizePath(current.rootPath);
      if (!pathWithinDirectory(normalizedPath, currentRoot)
        || current.visibleFiles.some((visiblePath) => normalizePath(visiblePath) === normalizedPath)) {
        return current;
      }

      const visibleFiles = uniqueNormalizedPaths([...current.visibleFiles, normalizedPath]);
      const nextWorkspace = {
        ...current,
        visibleFiles,
        fileTree: createFileTreeNodes(visibleFiles),
      };
      syncWorkspaceIndex(nextWorkspace);
      return nextWorkspace;
    });

    if (workspaceApi.updateWorkspaceIndexFiles) {
      void workspaceApi.updateWorkspaceIndexFiles(normalizedRoot, [normalizedPath], [])
        .then(onReplaceWorkspaceIndexState)
        .catch((error) => {
          onStatusChange(`Workspace index update failed: ${error instanceof Error ? error.message : String(error)}`);
        });
    } else {
      scheduleVisibleFilesIndex(normalizedRoot, [normalizedPath]);
    }
  }

  return {
    workspace,
    setWorkspace,
    recentProjects,
    setRecentProjects,
    syncWorkspaceIndex,
    scheduleVisibleFilesIndex,
    applyWorkspaceIndexRefreshResult,
    applyWorkspaceSnapshot,
    includeVisibleWorkspaceFile,
  };
}
