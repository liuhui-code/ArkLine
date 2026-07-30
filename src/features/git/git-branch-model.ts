export type GitBranchKind = "local" | "remote";

export type GitBranch = {
  name: string;
  displayName: string;
  kind: GitBranchKind;
  current: boolean;
  favorite: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
};

export type GitWorkingTreeState = {
  dirty: boolean;
  changedFiles: number;
  conflictedFiles: number;
};

export type GitBranchSnapshot = {
  rootPath: string;
  currentBranch: string | null;
  detached: boolean;
  localBranches: GitBranch[];
  remoteBranches: GitBranch[];
  recentBranches: string[];
  workingTree: GitWorkingTreeState;
};

export type GitCheckoutBranchRequest = {
  rootPath: string;
  name: string;
  kind: GitBranchKind;
  strategy: "preserve" | "stash";
};

export type GitCheckoutBranchResult = {
  snapshot: GitBranchSnapshot;
  message: string;
  stashRestored: boolean;
  stashKept: boolean;
};
