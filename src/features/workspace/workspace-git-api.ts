import type { GitBlameLine, GitCommitTrace, GitTraceUnavailable } from "@/features/git/git-trace-model";
import type { GitBranchSnapshot, GitCheckoutBranchRequest, GitCheckoutBranchResult } from "@/features/git/git-branch-model";
import type { GitCommitDetails, GitCommitDetailsRequest, GitCommitFileDiffRequest, GitHistoryActionRequest, GitHistoryPage, GitHistoryRequest } from "@/features/git/git-history-model";
import type { GitPushPreview, GitPushPreviewRequest } from "@/features/git/git-push-model";
import type { GitStashActionRequest, GitStashCreateRequest, GitStashDiffRequest, GitStashListRequest, GitStashPage } from "@/features/git/git-stash-model";
import type {
  GitCommitRequest,
  GitConflictContent,
  GitConflictContentRequest,
  GitDiffResult,
  GitFileComparison,
  GitDiscardResult,
  GitFileDiffRequest,
  GitMutationResult,
  GitPatchMutationResult,
  GitPatchRequest,
  GitPathsRequest,
  GitRemoteOperationRequest,
  GitRepositoryActionRequest,
  GitRepositorySnapshot,
  GitRepositorySnapshotRequest,
  GitResolveConflictRequest,
  GitRestoreDiscardRequest,
  GitRestorePatchRequest,
} from "@/features/git/git-source-control-model";

export type WorkspaceGitApi = {
  getGitRoots?(rootPath: string): Promise<string[]>;
  getFileBlame?(path: string): Promise<GitBlameLine[] | GitTraceUnavailable>;
  getCommitTrace?(path: string, commit: string, line: number): Promise<GitCommitTrace | GitTraceUnavailable>;
  listGitBranches?(rootPath: string): Promise<GitBranchSnapshot>;
  checkoutGitBranch?(request: GitCheckoutBranchRequest): Promise<GitCheckoutBranchResult>;
  getGitRepositorySnapshot?(request: GitRepositorySnapshotRequest): Promise<GitRepositorySnapshot>;
  cancelGitQuery?(requestId: string): Promise<boolean>;
  getGitFileDiff?(request: GitFileDiffRequest): Promise<GitDiffResult>;
  getGitFileComparison?(request: GitFileDiffRequest): Promise<GitFileComparison>;
  stageGitPaths?(request: GitPathsRequest): Promise<GitMutationResult>;
  unstageGitPaths?(request: GitPathsRequest): Promise<GitMutationResult>;
  discardGitPaths?(request: GitPathsRequest): Promise<GitDiscardResult>;
  restoreGitDiscard?(request: GitRestoreDiscardRequest): Promise<GitMutationResult>;
  applyGitPartialPatch?(request: GitPatchRequest): Promise<GitPatchMutationResult>;
  restoreGitPartialPatch?(request: GitRestorePatchRequest): Promise<GitMutationResult>;
  commitGitChanges?(request: GitCommitRequest): Promise<GitMutationResult>;
  runGitRemoteOperation?(request: GitRemoteOperationRequest): Promise<GitMutationResult>;
  getGitPushPreview?(request: GitPushPreviewRequest): Promise<GitPushPreview>;
  getGitHistory?(request: GitHistoryRequest): Promise<GitHistoryPage>;
  getGitCommitDetails?(request: GitCommitDetailsRequest): Promise<GitCommitDetails>;
  getGitCommitDiff?(request: GitCommitDetailsRequest): Promise<GitDiffResult>;
  getGitCommitFileDiff?(request: GitCommitFileDiffRequest): Promise<GitDiffResult>;
  runGitHistoryAction?(request: GitHistoryActionRequest): Promise<GitMutationResult>;
  getGitConflictContent?(request: GitConflictContentRequest): Promise<GitConflictContent>;
  resolveGitConflict?(request: GitResolveConflictRequest): Promise<GitMutationResult>;
  runGitRepositoryAction?(request: GitRepositoryActionRequest): Promise<GitMutationResult>;
  getGitStashes?(request: GitStashListRequest): Promise<GitStashPage>;
  createGitStash?(request: GitStashCreateRequest): Promise<GitMutationResult>;
  runGitStashAction?(request: GitStashActionRequest): Promise<GitMutationResult>;
  getGitStashDiff?(request: GitStashDiffRequest): Promise<GitDiffResult>;
};
