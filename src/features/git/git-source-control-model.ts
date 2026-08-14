export type GitChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

export type GitChangeEntry = {
  relativePath: string;
  absolutePath: string;
  originalPath: string | null;
  statusCode: string;
  kind: GitChangeKind;
  staged: boolean;
  unstaged: boolean;
  conflicted: boolean;
};

export type GitRepositoryOperation = "idle" | "merge" | "rebase" | "cherryPick" | "revert";

export type GitRepositorySnapshot = {
  rootPath: string;
  repositoryRoot: string;
  currentBranch: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  operation: GitRepositoryOperation;
  generation: number;
  snapshotId: string;
  totalChanges: number;
  stagedChanges: number;
  conflictedChanges: number;
  nextCursor: string | null;
  hasMore: boolean;
  changes: GitChangeEntry[];
};

export type GitRepositorySnapshotRequest = {
  rootPath: string;
  cursor: string | null;
  limit: number;
  requestId: string;
  timeoutMs: number;
};

export type GitFileDiffRequest = {
  rootPath: string;
  relativePath: string;
  originalPath: string | null;
  staged: boolean;
  scope?: "index" | "workingTree" | "commit";
  requestId: string;
  timeoutMs: number;
  maxBytes: number;
};

export type GitDiffResult = {
  content: string;
  truncated: boolean;
  totalBytes: number;
};

export type GitDiffDocument = {
  exists: boolean;
  binary: boolean;
  content: string | null;
  truncated: boolean;
  totalBytes: number;
};

export type GitFileComparison = {
  relativePath: string;
  staged: boolean;
  before: GitDiffDocument;
  after: GitDiffDocument;
  patch: GitDiffResult;
};

export type GitPathsRequest = {
  rootPath: string;
  paths: string[];
};

export type GitCommitRequest = {
  rootPath: string;
  message: string;
  amend: boolean;
  signOff: boolean;
};

export type GitRemoteOperation = "fetch" | "pull" | "pullRebase" | "pullMerge" | "push" | "forcePush";

export type GitRemoteOperationRequest = {
  rootPath: string;
  operation: GitRemoteOperation;
  remote: string | null;
  branch: string | null;
  timeoutMs: number;
};

export type GitMutationResult = {
  message: string;
  snapshot: GitRepositorySnapshot;
};

export type GitDiscardResult = {
  message: string;
  backupCommit: string;
  snapshot: GitRepositorySnapshot;
};

export type GitRestoreDiscardRequest = {
  rootPath: string;
  backupCommit: string;
  paths: string[];
};

export type GitPatchAction = "stage" | "unstage" | "discard";

export type GitPatchRequest = {
  rootPath: string;
  relativePath: string;
  patch: string;
  action: GitPatchAction;
};

export type GitPatchMutationResult = {
  message: string;
  backupCommit: string | null;
  snapshot: GitRepositorySnapshot;
};

export type GitRestorePatchRequest = {
  rootPath: string;
  relativePath: string;
  patch: string;
  backupCommit: string;
};

export type GitChangeSelection = {
  entry: GitChangeEntry;
  staged: boolean;
  commitView?: boolean;
};

export type GitDiffActionContext = {
  relativePath: string;
  staged: boolean;
  kind: GitChangeKind;
};

export type GitConflictContentRequest = {
  rootPath: string;
  relativePath: string;
};

export type GitConflictVersion = {
  exists: boolean;
  binary: boolean;
  content: string | null;
};

export type GitConflictContent = {
  relativePath: string;
  base: GitConflictVersion;
  current: GitConflictVersion;
  incoming: GitConflictVersion;
  result: string | null;
  binary: boolean;
};

export type GitConflictResolution = "content" | "current" | "incoming" | "delete";

export type GitResolveConflictRequest = {
  rootPath: string;
  relativePath: string;
  resolution: GitConflictResolution;
  content: string | null;
};

export type GitRepositoryActionRequest = {
  rootPath: string;
  action: "continue" | "abort";
};
