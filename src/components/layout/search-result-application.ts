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
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";

export type EntitySearchApplicationInput = {
  query: string;
  scope: WorkspaceIndexQueryScope;
  displayLimit: number;
  activePath: string | null;
  recentPaths: string[];
  readinessCursorAvailable: boolean;
  result: SearchEntityQueryResult;
};

export type TextSearchApplicationInput = {
  mode: SearchEverywhereMode;
  query: string;
  result: SearchTextQueryExecutionResult;
};

export function buildEntitySearchApplication({
  query,
  scope,
  displayLimit,
  activePath,
  recentPaths,
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
}: TextSearchApplicationInput) {
  return {
    patch: {
      ...buildTextSearchResultPatch(result.result),
      truncationNotice: textSearchPartialNotice(result.result),
    },
    previewIndex: 0,
    missReport: {
      mode,
      query,
      result: result.result,
      suppressMissExplain: result.suppressMissExplain,
    },
  };
}
