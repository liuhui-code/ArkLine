import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  textCandidatesToSearchResult,
} from "@/components/layout/search-everywhere-controller-model";
import {
  type TextSearchRequestRunnerInput,
  runTextSearchRequest,
} from "@/components/layout/search-request-runner";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchQueryTrackOptions } from "@/features/search/search-interaction-runtime";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import {
  buildSearchTextQueryRequest,
  executeSearchTextQuery,
  planSearchTextQuery,
} from "@/features/search/search-text-query-session";
import type { WorkspaceTextSearchOptions, WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type {
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryScope,
  WorkspaceIndexReadiness,
} from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

type TrackQuery = <T>(options: SearchQueryTrackOptions<T>) => Promise<void>;
type PatchSearchSession = (patch: Partial<SearchSessionSnapshot>) => void;

export type SearchTextWorkspaceApi = {
  queryWorkspaceCandidatesWithReadiness?: (
    rootPath: string,
    query: string,
    scope: WorkspaceIndexQueryScope,
    limit: number,
  ) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
};

export type SearchTextRunnerInput = {
  requestId: number;
  mode: SearchEverywhereMode;
  query: string;
  rootPath: string | null;
  minimumQueryLength: number;
  options: WorkspaceTextSearchOptions;
  dirty: boolean;
  workspaceApi: SearchTextWorkspaceApi;
  runFallback: (query: string, dirty: boolean, generation: number) => Promise<WorkspaceTextSearchResult>;
  replaceQueryReadiness: (readiness: WorkspaceIndexReadiness) => void;
  trackQuery: TrackQuery;
  clearSearchResults: (query: string) => void;
  patchSearchSession: PatchSearchSession;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  scheduleSelectedPreview: (selectedIndex: number) => void;
  reportMiss: TextSearchRequestRunnerInput["reportMiss"];
};

export function runSearchTextQuery({
  requestId,
  mode,
  query,
  rootPath,
  minimumQueryLength,
  options,
  dirty,
  workspaceApi,
  runFallback,
  replaceQueryReadiness,
  trackQuery,
  clearSearchResults,
  patchSearchSession,
  recordUiInteraction,
  scheduleSelectedPreview,
  reportMiss,
}: SearchTextRunnerInput) {
  if (!rootPath) return;
  patchSearchSession({ candidates: [], truncationNotice: null });
  const indexedText = workspaceApi.queryWorkspaceCandidatesWithReadiness;
  const plan = planSearchTextQuery({
    query,
    minimumQueryLength,
    options,
    dirty,
    indexedAvailable: Boolean(indexedText),
  });
  if (plan.kind === "clear") {
    clearSearchResults(plan.query);
    return;
  }

  runTextSearchRequest({
    requestId,
    mode,
    query,
    minimumQueryLength,
    trackQuery,
    clearSearchResults,
    patchSearchSession,
    request: () => executeSearchTextQuery(buildSearchTextQueryRequest({
      plan,
      rootPath,
      query,
      generation: requestId,
      runIndexed: (rootPath, query, scope, limit) => indexedText!(rootPath, query, scope, limit),
      runFallback: (query, generation) => runFallback(query, dirty, generation),
      convertIndexed: (items) => textCandidatesToSearchResult(rootPath, query, items),
      onIndexedReadiness: replaceQueryReadiness,
    })),
    recordUiInteraction,
    scheduleSelectedPreview,
    reportMiss,
  });
}
