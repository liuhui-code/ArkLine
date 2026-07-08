import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  getRelativeWorkspacePath,
  parseSearchQuery,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

export function searchOverlayLabel(mode: SearchEverywhereMode) {
  if (mode === "find") return "Find in Files";
  if (mode === "replace") return "Replace in Files";
  return "Search Everywhere";
}

export function textSearchInteractionKind(mode: SearchEverywhereMode): UiInteractionKind {
  return mode === "searchEverywhere" ? "searchEverywhere" : "globalSearch";
}

export function textSearchPartialNotice(result: WorkspaceTextSearchResult) {
  if (!result.partial && !result.limitReached) return null;
  const scanned = result.searchedFiles ? ` after scanning ${result.searchedFiles} file(s)` : "";
  if (result.limitReached) return `Showing first ${result.matches.length} matches${scanned}. Refine the query to see more.`;
  return `Search was interrupted${scanned}; showing partial results.`;
}

export function normalizeSelectedSearchText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 120) return "";
  return normalized;
}

export function textCandidatesToSearchResult(
  rootPath: string,
  query: string,
  candidates: SearchCandidate[],
): WorkspaceTextSearchResult {
  const parsedQuery = parseSearchQuery(query);
  if (parsedQuery.kind !== "text") return { query: parsedQuery, matches: [] };
  return {
    query: parsedQuery,
    matches: candidates.flatMap((candidate) => {
      if (candidate.source !== "text" || !candidate.path || !candidate.line || !candidate.column) return [];
      const preview = candidate.signature ?? candidate.title;
      const previewStart = Math.max(0, candidate.column - 1);
      const previewEnd = Math.min(preview.length, previewStart + parsedQuery.query.length);
      return [{
        path: candidate.path,
        relativePath: getRelativeWorkspacePath(rootPath, candidate.path),
        fileName: getPathBasename(candidate.path),
        line: candidate.line,
        column: candidate.column,
        summary: candidate.title,
        preview,
        previewStart,
        previewEnd,
        contextBefore: [],
        contextAfter: [],
      }];
    }),
  };
}
