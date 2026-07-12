import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { loadNextSearchPage } from "@/components/layout/search-next-page-loader";
import type { SearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import type { SearchSessionStore } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchCursor, WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type {
  WorkspaceIndexQueryEnvelope,
  WorkspaceSearchRankingContext,
} from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchNextPageActionOptions = {
  getMode: () => SearchEverywhereMode;
  sessionStore: SearchSessionStore;
  getRootPath: () => string | null;
  getQuery: () => string;
  getScope: () => WorkspaceIndexQueryScope;
  getRankingContext: () => WorkspaceSearchRankingContext;
  displayLimit: number;
  interactionRuntime: SearchInteractionRuntime;
  queryEntityPage?: (
    rootPath: string,
    query: string,
    scope: WorkspaceIndexQueryScope,
    limit: number,
    cursor: number,
    context?: WorkspaceSearchRankingContext,
  ) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  runTextPage: (
    query: string,
    dirty: boolean,
    generation: number,
    cursor: WorkspaceTextSearchCursor,
  ) => Promise<WorkspaceTextSearchResult>;
  hasDirtyDocuments: () => boolean;
  scheduleSelectedPreview: (selectedIndex: number) => void;
};

export function createSearchNextPageAction({
  getMode,
  sessionStore,
  getRootPath,
  getQuery,
  getScope,
  getRankingContext,
  displayLimit,
  interactionRuntime,
  queryEntityPage,
  runTextPage,
  hasDirtyDocuments,
  scheduleSelectedPreview,
}: SearchNextPageActionOptions) {
  return (selectIndexAfterLoad?: number) => loadNextSearchPage({
    mode: getMode(),
    session: sessionStore.getSnapshot(),
    rootPath: getRootPath(),
    query: getQuery(),
    scope: getScope(),
    rankingContext: getRankingContext(),
    displayLimit,
    requestId: interactionRuntime.getCurrentQueryGeneration(),
    selectIndexAfterLoad,
    queryEntityPage,
    runTextPage,
    hasDirtyDocuments,
    isCurrentQuery: interactionRuntime.isCurrentQuery,
    patchSearchSession: sessionStore.patch,
    scheduleSelectedPreview,
  });
}
