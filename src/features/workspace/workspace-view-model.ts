import { createFileTreeNodes } from "@/features/workspace/file-tree-store";
import type {
  WorkspaceSnapshot,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api-contract";
import {
  createWorkspaceStore,
  normalizePath,
  type WorkspaceOpenInput,
} from "@/features/workspace/workspace-store";

export function toWorkspaceViewModel(snapshot: WorkspaceSnapshot): WorkspaceViewModel {
  const store = createWorkspaceStore();
  const input: WorkspaceOpenInput = {
    rootPath: snapshot.rootPath,
    files: snapshot.files,
  };

  store.openWorkspace(input);

  return {
    rootName: snapshot.rootName,
    rootPath: normalizePath(snapshot.rootPath),
    visibleFiles: store.state.visibleFiles,
    fileTree: createFileTreeNodes(store.state.visibleFiles),
    scanSummary: snapshot.scanSummary ?? null,
  };
}
