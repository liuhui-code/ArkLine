import {
  buildSearchEntityQueryRequest,
  executeSearchEntityQuery,
} from "@/components/layout/search-entity-query-session";
import {
  type EntitySearchRequestRunnerInput,
  runEntitySearchRequest,
} from "@/components/layout/search-request-runner";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchQueryTrackOptions } from "@/features/search/search-interaction-runtime";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type {
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryScope,
  WorkspaceIndexReadiness,
  WorkspaceSearchRankingContext,
} from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

type TrackQuery = <T>(options: SearchQueryTrackOptions<T>) => Promise<void>;
type PatchSearchSession = (patch: Partial<SearchSessionSnapshot>) => void;

export type SearchEntityWorkspaceApi = {
  queryWorkspaceCandidatesWithReadiness?: (
    rootPath: string,
    query: string,
    scope: WorkspaceIndexQueryScope,
    limit: number,
    cursor?: number | null,
    context?: WorkspaceSearchRankingContext,
  ) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryWorkspaceCandidates?: (
    rootPath: string,
    query: string,
    scope: WorkspaceIndexQueryScope,
    limit: number,
    cursor?: number | null,
    context?: WorkspaceSearchRankingContext,
  ) => Promise<SearchCandidate[]>;
  queryWorkspaceSearchEverywhere?: (
    rootPath: string,
    query: string,
    limit: number,
  ) => Promise<SearchCandidate[]>;
};

export type SearchEntityRunnerInput = {
  requestId: number;
  query: string;
  rootPath: string | null;
  scope: WorkspaceIndexQueryScope;
  displayLimit: number;
  minimumQueryLength: number;
  activePath: string | null;
  recentPaths: string[];
  openedPaths: string[];
  queryIndexCandidates: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  workspaceApi: SearchEntityWorkspaceApi;
  replaceQueryReadiness: (readiness: WorkspaceIndexReadiness) => void;
  trackQuery: TrackQuery;
  clearSearchResults: (query: string) => void;
  patchSearchSession: PatchSearchSession;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  reportMiss: EntitySearchRequestRunnerInput["reportMiss"];
};

export function runSearchEntityQuery({
  requestId,
  query,
  rootPath,
  scope,
  displayLimit,
  minimumQueryLength,
  activePath,
  recentPaths,
  openedPaths,
  queryIndexCandidates,
  workspaceApi,
  replaceQueryReadiness,
  trackQuery,
  clearSearchResults,
  patchSearchSession,
  recordUiInteraction,
  reportMiss,
}: SearchEntityRunnerInput) {
  if (!rootPath) return;
  const rankingContext: WorkspaceSearchRankingContext = { activePath, recentPaths, openedPaths };
  runEntitySearchRequest({
    requestId,
    query,
    minimumQueryLength,
    trackQuery,
    clearSearchResults,
    request: () => executeSearchEntityQuery(buildSearchEntityQueryRequest({
      query,
      scope,
      limit: displayLimit + 1,
      runReadiness: workspaceApi.queryWorkspaceCandidatesWithReadiness
        ? (query, scope, limit) => workspaceApi.queryWorkspaceCandidatesWithReadiness!(
          rootPath,
          query,
          scope,
          limit,
          null,
          rankingContext,
        )
        : undefined,
      runIndexed: workspaceApi.queryWorkspaceCandidates
        ? (query, scope, limit) => workspaceApi.queryWorkspaceCandidates!(
          rootPath,
          query,
          scope,
          limit,
          null,
          rankingContext,
        )
        : undefined,
      runLegacy: workspaceApi.queryWorkspaceSearchEverywhere
        ? (query, limit) => workspaceApi.queryWorkspaceSearchEverywhere!(rootPath, query, limit)
        : undefined,
      runLocal: queryIndexCandidates,
      onReadiness: (envelope) => {
        replaceQueryReadiness(envelope.readiness);
      },
    })),
    application: {
      scope,
      displayLimit,
      activePath,
      recentPaths,
      openedPaths,
      readinessCursorAvailable: Boolean(workspaceApi.queryWorkspaceCandidatesWithReadiness),
    },
    patchSearchSession,
    recordUiInteraction,
    reportMiss,
  });
}
