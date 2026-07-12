import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  buildSearchEntityAppendPatch,
} from "@/components/layout/search-entity-query-session";
import {
  buildTextSearchAppendPatch,
} from "@/components/layout/search-pagination-session";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchCursor, WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type {
  WorkspaceIndexQueryEnvelope,
  WorkspaceSearchRankingContext,
} from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchNextPageLoaderInput = {
  mode: SearchEverywhereMode;
  session: SearchSessionSnapshot;
  rootPath: string | null;
  query: string;
  scope: WorkspaceIndexQueryScope;
  rankingContext?: WorkspaceSearchRankingContext;
  displayLimit: number;
  requestId: number;
  selectIndexAfterLoad?: number;
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
  isCurrentQuery: (requestId: number) => boolean;
  patchSearchSession: (patch: Partial<SearchSessionSnapshot>) => void;
  scheduleSelectedPreview: (selectedIndex: number) => void;
};

export async function loadNextSearchPage({
  mode,
  session,
  rootPath,
  query,
  scope,
  rankingContext,
  displayLimit,
  requestId,
  selectIndexAfterLoad,
  queryEntityPage,
  runTextPage,
  hasDirtyDocuments,
  isCurrentQuery,
  patchSearchSession,
  scheduleSelectedPreview,
}: SearchNextPageLoaderInput) {
  if (!rootPath || session.textPageLoading) return;
  if (mode === "searchEverywhere") {
    if (!session.entityNextCursor || !queryEntityPage) return;
    patchSearchSession({ textPageLoading: true });
    const envelope = await queryEntityPage(
      rootPath,
      query,
      scope,
      displayLimit,
      session.entityNextCursor,
      rankingContext,
    );
    if (!isCurrentQuery(requestId)) return;
    patchSearchSession(buildSearchEntityAppendPatch(
      session.candidates,
      envelope.items,
      envelope.nextCursor,
      selectIndexAfterLoad ?? session.selectedIndex,
    ));
    return;
  }
  if (!session.textNextCursor) return;
  patchSearchSession({ textPageLoading: true });
  const result = await runTextPage(query, hasDirtyDocuments(), requestId, session.textNextCursor);
  if (!isCurrentQuery(requestId)) return;
  patchSearchSession(buildTextSearchAppendPatch(session, result, selectIndexAfterLoad));
  if (selectIndexAfterLoad != null) scheduleSelectedPreview(selectIndexAfterLoad);
}
