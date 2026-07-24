import { rankPaths } from "@/features/search/fuzzy-matcher";
import type {
  WorkspaceIndexQueryScope,
  WorkspaceIndexReadiness,
} from "@/features/workspace/workspace-index-api-types";
import type {
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api-contract";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export type WorkspaceIndexStatus = "empty" | "scanning" | "ready" | "partial" | "stale" | "failed";

export type SearchCandidateFreshness = "ready" | "partial" | "stale";

export type SearchCandidate = {
  id: string;
  source: "file" | "class" | "symbol" | "text" | "action" | "sdk" | "api";
  kind: string;
  title: string;
  subtitle: string;
  path?: string;
  line?: number;
  column?: number;
  score: number;
  freshness: SearchCandidateFreshness;
  container?: string | null;
  signature?: string | null;
  visibility?: string | null;
};

export type WorkspaceIndexedSymbol = {
  source: "class" | "symbol";
  kind: string;
  name: string;
  path: string;
  line: number;
  column: number;
  container?: string;
};

export type WorkspaceIndexState = {
  status: WorkspaceIndexStatus;
  rootPath: string | null;
  filePaths: string[];
  symbols?: WorkspaceIndexedSymbol[];
  indexedAt: number | null;
  partialReason: string | null;
  queryReadiness?: WorkspaceIndexReadiness | null;
};

function createInitialState(): WorkspaceIndexState {
  return {
    status: "empty",
    rootPath: null,
    filePaths: [],
    symbols: [],
    indexedAt: null,
    partialReason: null,
    queryReadiness: null,
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
      state.symbols = [];
      state.status = workspace.scanSummary.truncated ? "partial" : "ready";
      state.indexedAt = Date.now();
      state.partialReason = buildPartialReason(workspace);
      state.queryReadiness = null;
    },
    replaceState(nextState: WorkspaceIndexState) {
      state.rootPath = nextState.rootPath ? normalizePath(nextState.rootPath) : null;
      state.filePaths = nextState.filePaths.map(normalizePath);
      state.symbols = (nextState.symbols ?? []).map((symbol) => ({ ...symbol, path: normalizePath(symbol.path) }));
      state.status = nextState.status;
      state.indexedAt = nextState.indexedAt;
      state.partialReason = nextState.partialReason;
      state.queryReadiness = nextState.queryReadiness ?? null;
    },
    includeFilePath(path: string) {
      const normalizedPath = normalizePath(path);
      if (!state.filePaths.includes(normalizedPath)) {
        state.filePaths.push(normalizedPath);
      }
    },
    replaceQueryReadiness(readiness: WorkspaceIndexReadiness) {
      state.queryReadiness = {
        ...readiness,
        rootPath: normalizePath(readiness.rootPath),
      };
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
        line: 1,
        column: 1,
        score: match.score,
        freshness,
      }));
    },
    querySearchEverywhere(query: string, limit = 16): SearchCandidate[] {
      const fileCandidates = this.queryQuickOpen(query, Math.ceil(limit / 2));
      const symbolCandidates = rankSymbols(state.symbols ?? [], query, limit - fileCandidates.length, candidateFreshness(state.status));
      return [...symbolCandidates, ...fileCandidates]
        .sort((left, right) => sourcePriority(left.source) - sourcePriority(right.source) || right.score - left.score)
        .slice(0, limit);
    },
    queryCandidates(query: string, scope: WorkspaceIndexQueryScope, limit = 16): SearchCandidate[] {
      if (scope === "files") {
        return this.queryQuickOpen(query, limit);
      }

      if (scope === "classes" || scope === "symbols") {
        const source = scope === "classes" ? "class" : "symbol";
        const symbols = state.symbols ?? [];
        return rankSymbols(symbols, query, Math.max(symbols.length, limit), candidateFreshness(state.status))
          .filter((candidate) => candidate.source === source)
          .slice(0, limit);
      }

      if (scope === "api") {
        return [];
      }

      return this.querySearchEverywhere(query, limit);
    },
    getTextSearchPaths() {
      return [...state.filePaths];
    },
  };
}

function rankSymbols(
  symbols: WorkspaceIndexedSymbol[],
  query: string,
  limit: number,
  freshness: SearchCandidateFreshness,
): SearchCandidate[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed || limit <= 0) {
    return [];
  }

  return symbols
    .map((symbol) => {
      const name = symbol.name.toLowerCase();
      const score = name === trimmed ? 120 : name.startsWith(trimmed) ? 90 : name.includes(trimmed) ? 60 : 0;
      return score > 0 ? { symbol, score } : null;
    })
    .filter((item): item is { symbol: WorkspaceIndexedSymbol; score: number } => item !== null)
    .sort((left, right) => right.score - left.score || left.symbol.name.localeCompare(right.symbol.name))
    .slice(0, limit)
    .map(({ symbol, score }) => ({
      id: `${symbol.source}:${symbol.path}:${symbol.line}:${symbol.column}`,
      source: symbol.source,
      kind: symbol.kind,
      title: symbol.name,
      subtitle: symbol.container ? `${symbol.container} · ${symbol.path}` : symbol.path,
      path: symbol.path,
      line: symbol.line,
      column: symbol.column,
      score,
      freshness,
      container: symbol.container,
      signature: undefined,
      visibility: undefined,
    }));
}

function sourcePriority(source: SearchCandidate["source"]) {
  return source === "class" ? 0 : source === "symbol" ? 1 : source === "file" ? 2 : 3;
}
