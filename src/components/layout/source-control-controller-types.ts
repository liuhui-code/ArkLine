import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { GitDiffActionContext, GitFileComparison, GitRemoteOperation } from "@/features/git/git-source-control-model";
import type { GitDocumentReconciler } from "@/components/layout/use-git-document-safety";

export type SourceControlOperation = "idle" | "diff" | "stage" | "unstage" | "discard" | "restoreDiscard" | "commit" | "conflict" | "resolveConflict" | "continue" | "abort" | GitRemoteOperation;

export type UseSourceControlControllerOptions = {
  active: boolean;
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  onOpenDiff: (diff: string, context?: GitDiffActionContext, comparison?: GitFileComparison | null) => void;
  onStatusChange: (message: string) => void;
  getDirtyDocumentPaths?: () => string[];
  saveDirtyDocuments?: (paths: string[]) => Promise<void>;
  reconcileDocuments?: GitDocumentReconciler;
};
