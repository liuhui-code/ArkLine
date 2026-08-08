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
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import { runStreamingTextSearch } from "@/components/layout/search-text-stream-runner";

type TrackQuery = <T>(options: SearchQueryTrackOptions<T>) => Promise<void>;
type PatchSearchSession = (patch: Partial<SearchSessionSnapshot>) => void;

export type SearchTextWorkspaceApi = {
  queryWorkspaceCandidatesWithReadiness?: (
    rootPath: string,
    query: string,
    scope: WorkspaceIndexQueryScope,
    limit: number,
    cursor?: number | null,
    context?: undefined,
    generation?: number,
    deadlineMs?: number,
  ) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  streamWorkspaceText?: WorkspaceApi["streamWorkspaceText"];
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
  isCurrentQuery?: (generation: number) => boolean;
  clearSearchResults: (query: string) => void;
  patchSearchSession: PatchSearchSession;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  scheduleSelectedPreview: (selectedIndex: number) => void;
  reportMiss: TextSearchRequestRunnerInput["reportMiss"];
  onStreamError?: (message: string) => void;
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
  isCurrentQuery = (generation) => generation === requestId,
  clearSearchResults,
  patchSearchSession,
  recordUiInteraction,
  scheduleSelectedPreview,
  reportMiss,
  onStreamError,
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
  if (mode !== "searchEverywhere" && !dirty && workspaceApi.streamWorkspaceText) {
    runStreamingTextSearch({
      requestId,
      mode,
      query,
      request: {
        rootPath,
        query,
        generation: requestId,
        cursor: null,
        options,
        limit: 50,
        contextLines: 0,
      },
      stream: workspaceApi.streamWorkspaceText,
      isCurrentQuery,
      trackQuery,
      patchSearchSession,
      scheduleSelectedPreview,
      reportMiss,
      recordUiInteraction,
      onStreamError,
    });
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
      runIndexed: (rootPath, query, scope, limit) => indexedText!(
        rootPath,
        query,
        scope,
        limit,
        null,
        undefined,
        requestId,
        1_500,
      ),
      runFallback: (query, generation) => runFallback(query, dirty, generation),
      convertIndexed: (items) => textCandidatesToSearchResult(rootPath, query, items),
      onIndexedReadiness: replaceQueryReadiness,
    })),
    recordUiInteraction,
    scheduleSelectedPreview,
    reportMiss,
  });
}
