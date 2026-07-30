export type GitStashEntry = {
  index: number;
  reference: string;
  commit: string;
  subject: string;
  createdAtEpochSeconds: number;
};

export type GitStashListRequest = {
  rootPath: string;
  cursor: number | null;
  limit: number;
};

export type GitStashPage = {
  entries: GitStashEntry[];
  total: number;
  nextCursor: number | null;
  hasMore: boolean;
};

export type GitStashCreateRequest = {
  rootPath: string;
  message: string;
  includeUntracked: boolean;
  keepIndex: boolean;
};

export type GitStashAction = "apply" | "pop" | "drop";

export type GitStashActionRequest = {
  rootPath: string;
  reference: string;
  expectedCommit: string;
  action: GitStashAction;
  restoreIndex: boolean;
};

export type GitStashDiffRequest = {
  rootPath: string;
  reference: string;
  expectedCommit: string;
  requestId: string;
  timeoutMs: number;
  maxBytes: number;
};
