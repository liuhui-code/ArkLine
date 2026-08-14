export type GitHistoryRequest = {
  rootPath: string;
  refName?: string | null;
  cursor: string | null;
  limit: number;
  requestId: string;
  timeoutMs: number;
};

export type GitCommitSummary = {
  commit: string;
  shortCommit: string;
  parents: string[];
  refs: string[];
  subject: string;
  author: string;
  authorEmail: string;
  authoredAtEpochSeconds: number;
  graph: string;
};

export type GitHistoryPage = {
  commits: GitCommitSummary[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type GitCommitDetailsRequest = {
  rootPath: string;
  commit: string;
  requestId: string;
  timeoutMs: number;
  maxDiffBytes: number;
};

export type GitCommitFileDiffRequest = {
  rootPath: string;
  commit: string;
  relativePath: string;
  previousPath: string | null;
  requestId: string;
  timeoutMs: number;
  maxDiffBytes: number;
};

export type GitHistoryAction = "cherryPick" | "revert";

export type GitHistoryActionRequest = {
  rootPath: string;
  commit: string;
  action: GitHistoryAction;
};

export type GitCommitFile = {
  status: string;
  path: string;
  previousPath: string | null;
};

export type GitCommitDetails = {
  commit: string;
  shortCommit: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authoredAtEpochSeconds: number;
  subject: string;
  body: string;
  files: GitCommitFile[];
  filesTruncated: boolean;
};
