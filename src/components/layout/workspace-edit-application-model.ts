import {
  pathWithinDirectory,
  replaceDirectoryPrefix,
  uniqueNormalizedPaths,
} from "@/components/layout/app-shell-model";
import type { WorkspaceEditPlan } from "@/features/code-actions/code-action-model";
import { createFileTreeNodes } from "@/features/workspace/file-tree-store";
import { normalizePath } from "@/features/workspace/workspace-store";

export type AppliedWorkspaceEditUpdate = {
  visibleFiles: string[];
  fileTree: ReturnType<typeof createFileTreeNodes>;
  addedIndexPaths: string[];
  removedIndexPaths: string[];
};

export function buildAppliedWorkspaceEditUpdate({
  visibleFiles,
  plan,
}: {
  visibleFiles: string[];
  plan: WorkspaceEditPlan;
}): AppliedWorkspaceEditUpdate {
  const paths = new Set(visibleFiles.map(normalizePath));
  const addedIndexPaths = new Set<string>();
  const removedIndexPaths = new Set<string>();

  for (const operation of plan.operations) {
    switch (operation.kind) {
      case "createFile":
        paths.add(normalizePath(operation.path));
        addedIndexPaths.add(normalizePath(operation.path));
        break;
      case "renameFile":
        paths.delete(normalizePath(operation.oldPath));
        paths.add(normalizePath(operation.newPath));
        removedIndexPaths.add(normalizePath(operation.oldPath));
        addedIndexPaths.add(normalizePath(operation.newPath));
        break;
      case "renameDirectory": {
        const affectedPaths = [...paths].filter((path) => pathWithinDirectory(path, operation.oldPath));
        affectedPaths.forEach((path) => {
          paths.delete(path);
          removedIndexPaths.add(path);
          const newPath = replaceDirectoryPrefix(path, operation.oldPath, operation.newPath);
          paths.add(newPath);
          addedIndexPaths.add(newPath);
        });
        break;
      }
      case "deleteFile":
        paths.delete(normalizePath(operation.path));
        removedIndexPaths.add(normalizePath(operation.path));
        break;
      case "deleteDirectory": {
        const affectedPaths = [...paths].filter((path) => pathWithinDirectory(path, operation.path));
        affectedPaths.forEach((path) => {
          paths.delete(path);
          removedIndexPaths.add(path);
        });
        break;
      }
      case "text":
        paths.add(normalizePath(operation.path));
        addedIndexPaths.add(normalizePath(operation.path));
        break;
      case "createDirectory":
        break;
    }
  }

  const nextVisibleFiles = uniqueNormalizedPaths([...paths]);
  return {
    visibleFiles: nextVisibleFiles,
    fileTree: createFileTreeNodes(nextVisibleFiles),
    addedIndexPaths: [...addedIndexPaths],
    removedIndexPaths: [...removedIndexPaths],
  };
}
