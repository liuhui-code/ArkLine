import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { runSearchEntityQuery } from "@/components/layout/search-entity-runner";
import type { SearchMissReporters } from "@/components/layout/search-miss-reporters";
import { runSearchTextQuery } from "@/components/layout/search-text-runner";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchQueryTrackOptions } from "@/features/search/search-interaction-runtime";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type {
  SearchEntityWorkspaceApi,
} from "@/components/layout/search-entity-runner";
import type {
  SearchTextWorkspaceApi,
} from "@/components/layout/search-text-runner";
import type {
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

type TrackQuery = <T>(options: SearchQueryTrackOptions<T>) => Promise<void>;

export type SearchRunActionsOptions = {
  getQuery: () => string;
  getRootPath: () => string | null;
  getMode: () => SearchEverywhereMode;
  getScope: () => WorkspaceIndexQueryScope;
  getOptions: () => WorkspaceTextSearchOptions;
  getDirty: () => boolean;
  displayLimit: number;
  minimumQueryLength: number;
  activePath: string | null;
  recentPaths: string[];
  openedPaths: string[];
  queryIndexCandidates: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  workspaceApi: SearchEntityWorkspaceApi & SearchTextWorkspaceApi;
  replaceQueryReadiness: (readiness: WorkspaceIndexReadiness) => void;
  trackQuery: TrackQuery;
  clearSearchResults: (query: string) => void;
  patchSearchSession: (patch: Partial<SearchSessionSnapshot>) => void;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  scheduleSelectedPreview: (selectedIndex: number) => void;
  reportEntityMiss: SearchMissReporters["reportEntityMiss"];
  reportTextMiss: SearchMissReporters["reportTextMiss"];
  runFallback: (query: string, dirty: boolean, generation: number) => Promise<WorkspaceTextSearchResult>;
};

export function createSearchRunActions(options: SearchRunActionsOptions) {
  return {
    runEntitySearch(requestId: number) {
      runSearchEntityQuery({
        requestId,
        query: options.getQuery(),
        rootPath: options.getRootPath(),
        scope: options.getScope(),
        displayLimit: options.displayLimit,
        minimumQueryLength: options.minimumQueryLength,
        activePath: options.activePath,
        recentPaths: options.recentPaths,
        openedPaths: options.openedPaths,
        queryIndexCandidates: options.queryIndexCandidates,
        workspaceApi: options.workspaceApi,
        replaceQueryReadiness: options.replaceQueryReadiness,
        trackQuery: options.trackQuery,
        clearSearchResults: options.clearSearchResults,
        patchSearchSession: options.patchSearchSession,
        recordUiInteraction: options.recordUiInteraction,
        reportMiss: options.reportEntityMiss,
      });
    },
    runTextSearch(requestId: number) {
      runSearchTextQuery({
        requestId,
        mode: options.getMode(),
        query: options.getQuery(),
        rootPath: options.getRootPath(),
        minimumQueryLength: options.minimumQueryLength,
        options: options.getOptions(),
        dirty: options.getDirty(),
        workspaceApi: options.workspaceApi,
        runFallback: options.runFallback,
        replaceQueryReadiness: options.replaceQueryReadiness,
        trackQuery: options.trackQuery,
        clearSearchResults: options.clearSearchResults,
        patchSearchSession: options.patchSearchSession,
        recordUiInteraction: options.recordUiInteraction,
        scheduleSelectedPreview: options.scheduleSelectedPreview,
        reportMiss: options.reportTextMiss,
      });
    },
  };
}
