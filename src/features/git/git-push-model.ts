import type { GitCommitSummary } from "@/features/git/git-history-model";

export type GitPushPreviewRequest = {
  rootPath: string;
  requestId: string;
  timeoutMs: number;
};

export type GitPushPreview = {
  rootPath: string;
  repositoryRoot: string;
  localBranch: string;
  remote: string;
  remoteBranch: string;
  hasUpstream: boolean;
  totalCommits: number;
  commitsTruncated: boolean;
  commits: GitCommitSummary[];
};
