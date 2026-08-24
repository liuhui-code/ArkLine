import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  buildSearchEntityPatch,
  type SearchEntityQueryResult,
} from "@/components/layout/search-entity-query-session";
import { textSearchPartialNotice } from "@/components/layout/search-everywhere-controller-model";
import {
  buildTextSearchResultPatch,
  type SearchTextQueryExecutionResult,
} from "@/features/search/search-text-query-session";
import type { WorkspaceTextSearchMatch, WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";

export type EntitySearchApplicationInput = {
  query: string;
  scope: WorkspaceIndexQueryScope;
  displayLimit: number;
  activePath: string | null;
  recentPaths: string[];
  openedPaths: string[];
  readinessCursorAvailable: boolean;
  result: SearchEntityQueryResult;
};

export type TextSearchApplicationInput = {
  mode: SearchEverywhereMode;
  query: string;
  result: SearchTextQueryExecutionResult;
  selectionAnchor?: TextSearchSelectionAnchor | null;
};

export type TextSearchSelectionAnchor = Pick<WorkspaceTextSearchMatch, "path" | "line" | "column">;

export function buildEntitySearchApplication({
  query,
  scope,
  displayLimit,
  activePath,
  recentPaths,
  openedPaths,
  readinessCursorAvailable,
  result,
}: EntitySearchApplicationInput) {
  const { patch, visibleCount } = buildSearchEntityPatch({
    ...result,
    query,
    scope,
    displayLimit,
    activePath,
    recentPaths,
    openedPaths,
    readinessCursorAvailable,
  });
  return {
    patch,
    missReport: visibleCount === 0 && query.trim()
      ? { query, explain: result.explain }
      : null,
  };
}

export function buildTextSearchApplication({
  mode,
  query,
  result,
  selectionAnchor,
}: TextSearchApplicationInput) {
  const selectedIndex = resolveTextSearchSelection(result.result, selectionAnchor);
  return {
    patch: {
      ...buildTextSearchResultPatch(result.result),
      truncationNotice: textSearchPartialNotice(result.result),
      selectedIndex,
    },
    previewIndex: selectedIndex,
    missReport: {
      mode,
      query,
      result: result.result,
      suppressMissExplain: result.suppressMissExplain,
    },
  };
}

export function resolveTextSearchSelection(
  result: WorkspaceTextSearchResult,
  anchor?: TextSearchSelectionAnchor | null,
) {
  if (!anchor) return 0;
  const index = result.matches.findIndex((match) => (
    match.path === anchor.path && match.line === anchor.line && match.column === anchor.column
  ));
  return index >= 0 ? index : 0;
}
