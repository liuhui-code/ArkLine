export type GitTraceUnavailableReason =
  | "gitUnavailable"
  | "notTracked"
  | "notRepository"
  | "unsaved"
  | "detailUnavailable";

export type GitTraceUnavailable = {
  kind: "unavailable";
  reason: GitTraceUnavailableReason;
  message: string;
};

export type GitBlameLine = {
  line: number;
  commit: string;
  sourceLine: number;
  author: string;
  authoredAt: string;
  relativeTime: string;
  summary: string;
};

export type GitCommitTrace = {
  commit: string;
  shortCommit: string;
  author: string;
  email?: string;
  authoredAt: string;
  subject: string;
  relativePath: string;
  selectedLine: number;
  sourceLine: number;
  patch: string;
};
