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

export type GitTraceUnavailableOr<T> = T | GitTraceUnavailable;

export type GitBlameLine = {
  line: number;
  commit: string;
  sourceLine: number;
  author: string;
  authoredAt: string;
  relativeTime: string;
  summary: string;
};

export type GitBlameAttributionStatus = "committed" | "added" | "modified" | "unavailable";

export type GitBlameAttribution = {
  bufferLine: number;
  sourceLine?: number;
  status: GitBlameAttributionStatus;
  commit?: string;
  shortCommit?: string;
  author?: string;
  authoredAt?: string;
  relativeTime?: string;
  summary?: string;
  originalCommit?: string;
  originalAuthor?: string;
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

export type GitTraceState = {
  blameStatus: "idle" | "loading" | "ready" | "unavailable" | "error";
  blameLines: GitBlameLine[];
  blameAttributions: GitBlameAttribution[];
  selectedLine: number | null;
  selectedCommit: string | null;
  detailStatus: "idle" | "loading" | "ready" | "unavailable" | "error";
  detail: GitCommitTrace | null;
  message?: string;
};

export function createDefaultGitTraceState(): GitTraceState {
  return {
    blameStatus: "idle",
    blameLines: [],
    blameAttributions: [],
    selectedLine: null,
    selectedCommit: null,
    detailStatus: "idle",
    detail: null,
    message: undefined,
  };
}

export function isGitTraceUnavailable(value: unknown): value is GitTraceUnavailable {
  return !!value && typeof value === "object" && "kind" in value && (value as { kind?: string }).kind === "unavailable";
}
