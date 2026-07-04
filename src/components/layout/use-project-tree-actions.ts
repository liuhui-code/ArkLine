import { useState } from "react";
import type { WorkspaceApi, WorkspaceDirectoryEntry, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { normalizePath } from "@/features/workspace/workspace-store";

export type UseProjectTreeActionsOptions = {
  workspaceApi: WorkspaceApi;
  onStatusChange: (message: string) => void;
};

export function useProjectTreeActions({ workspaceApi, onStatusChange }: UseProjectTreeActionsOptions) {
  const [projectTreeChildren, setProjectTreeChildren] = useState<Record<string, WorkspaceDirectoryEntry[]>>({});
  const [projectTreeLoadingPaths, setProjectTreeLoadingPaths] = useState<Set<string>>(() => new Set());
  const [selectedProjectPath, setSelectedProjectPath] = useState<string | null>(null);

  function resetProjectTree() {
    setProjectTreeChildren({});
    setProjectTreeLoadingPaths(new Set());
    setSelectedProjectPath(null);
  }

  async function loadProjectDirectory(rootPath: string, directoryPath: string) {
    if (!workspaceApi.listWorkspaceDirectory) {
      return;
    }

    const normalizedPath = normalizePath(directoryPath);
    if (projectTreeLoadingPaths.has(normalizedPath)) {
      return;
    }

    setProjectTreeLoadingPaths((current) => new Set(current).add(normalizedPath));
    try {
      const entries = await workspaceApi.listWorkspaceDirectory(rootPath, normalizedPath);
      setProjectTreeChildren((current) => ({
        ...current,
        [normalizedPath]: entries.map((entry) => ({
          ...entry,
          path: normalizePath(entry.path),
        })),
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Project tree failed: ${message}`);
    } finally {
      setProjectTreeLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(normalizedPath);
        return next;
      });
    }
  }

  function loadProjectDirectoryForWorkspace(workspace: WorkspaceViewModel | null, path: string) {
    if (!workspace) {
      return;
    }

    const normalizedPath = normalizePath(path);
    if (projectTreeChildren[normalizedPath]) {
      return;
    }

    void loadProjectDirectory(workspace.rootPath, normalizedPath);
  }

  return {
    projectTreeChildren,
    projectTreeLoadingPaths,
    selectedProjectPath,
    setSelectedProjectPath,
    resetProjectTree,
    loadProjectDirectory,
    loadProjectDirectoryForWorkspace,
  };
}
