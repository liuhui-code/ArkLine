import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { GitDiffActionContext, GitFileComparison, GitRemoteOperation, GitRepositorySnapshot } from "@/features/git/git-source-control-model";
import type { GitDocumentReconciler } from "@/components/layout/use-git-document-safety";
import type { GitCommitAction } from "@/features/git/git-commit-model";

export type SourceControlOperation = "idle" | "diff" | "stage" | "unstage" | "discard" | "restoreDiscard" | "commit" | "conflict" | "resolveConflict" | "continue" | "abort" | GitRemoteOperation;

export type UseSourceControlControllerOptions = {
  active: boolean;
  rootPath: string | null;
  workspaceApi: WorkspaceApi;
  onOpenDiff: (diff: string, context?: GitDiffActionContext, comparison?: GitFileComparison | null) => void;
  onStatusChange: (message: string) => void;
  onCommitComplete?: (action: GitCommitAction, snapshot: GitRepositorySnapshot) => void;
  getDirtyDocumentPaths?: () => string[];
  saveDirtyDocuments?: (paths: string[]) => Promise<void>;
  reconcileDocuments?: GitDocumentReconciler;
};
