import { rankPaths } from "@/features/search/fuzzy-matcher";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export type WorkspaceIndexStatus = "empty" | "scanning" | "ready" | "partial" | "stale" | "failed";

export type SearchCandidateFreshness = "ready" | "partial" | "stale";

export type SearchCandidate = {
  id: string;
  source: "file" | "class" | "symbol" | "text" | "action" | "sdk";
  kind: string;
  title: string;
  subtitle: string;
  path?: string;
  score: number;
  freshness: SearchCandidateFreshness;
};

export type WorkspaceIndexState = {
  status: WorkspaceIndexStatus;
  rootPath: string | null;
  filePaths: string[];
  indexedAt: number | null;
  partialReason: string | null;
};

function createInitialState(): WorkspaceIndexState {
  return {
    status: "empty",
    rootPath: null,
    filePaths: [],
    indexedAt: null,
    partialReason: null,
  };
}

function buildPartialReason(workspace: WorkspaceViewModel) {
  if (!workspace.scanSummary.truncated) {
    return null;
  }

  return `Partial workspace results: scan stopped at ${workspace.scanSummary.scannedFiles.toLocaleString()} files; excluded ${workspace.scanSummary.skippedEntries.toLocaleString()} generated/dependency entries.`;
}

function candidateFreshness(status: WorkspaceIndexStatus): SearchCandidateFreshness {
  if (status === "partial") {
    return "partial";
  }

  if (status === "stale" || status === "failed") {
    return "stale";
  }

  return "ready";
}

export function createWorkspaceIndexStore() {
  const state = createInitialState();

  return {
    state,
    openWorkspace(workspace: WorkspaceViewModel) {
      state.rootPath = normalizePath(workspace.rootPath);
      state.filePaths = workspace.visibleFiles.map(normalizePath);
      state.status = workspace.scanSummary.truncated ? "partial" : "ready";
      state.indexedAt = Date.now();
      state.partialReason = buildPartialReason(workspace);
    },
    replaceState(nextState: WorkspaceIndexState) {
      state.rootPath = nextState.rootPath ? normalizePath(nextState.rootPath) : null;
      state.filePaths = nextState.filePaths.map(normalizePath);
      state.status = nextState.status;
      state.indexedAt = nextState.indexedAt;
      state.partialReason = nextState.partialReason;
    },
    reset() {
      Object.assign(state, createInitialState());
    },
    queryQuickOpen(query: string, limit = 8): SearchCandidate[] {
      const freshness = candidateFreshness(state.status);

      return rankPaths(state.filePaths, query, limit).map((match) => ({
        id: `file:${match.path}`,
        source: "file",
        kind: "file",
        title: getPathBasename(match.path),
        subtitle: match.path,
        path: match.path,
        score: match.score,
        freshness,
      }));
    },
    getTextSearchPaths() {
      return [...state.filePaths];
    },
  };
}
