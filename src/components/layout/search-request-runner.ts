import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  buildEntitySearchApplication,
  buildTextSearchApplication,
  type EntitySearchApplicationInput,
} from "@/components/layout/search-result-application";
import type { SearchEntityQueryResult } from "@/components/layout/search-entity-query-session";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchQueryTrackOptions } from "@/features/search/search-interaction-runtime";
import type { SearchTextQueryExecutionResult } from "@/features/search/search-text-query-session";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";

type TrackQuery = <T>(options: SearchQueryTrackOptions<T>) => Promise<void>;
type PatchSearchSession = (patch: Partial<SearchSessionSnapshot>) => void;

export type EntitySearchRequestRunnerInput = {
  requestId: number;
  query: string;
  minimumQueryLength: number;
  trackQuery: TrackQuery;
  clearSearchResults: (query: string) => void;
  request: () => Promise<SearchEntityQueryResult>;
  application: Omit<EntitySearchApplicationInput, "query" | "result">;
  patchSearchSession: PatchSearchSession;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  reportMiss: (requestId: number, missReport: NonNullable<ReturnType<typeof buildEntitySearchApplication>["missReport"]>) => void;
  now?: () => number;
};

export type TextSearchRequestRunnerInput = {
  requestId: number;
  mode: SearchEverywhereMode;
  query: string;
  minimumQueryLength: number;
  trackQuery: TrackQuery;
  clearSearchResults: (query: string) => void;
  patchSearchSession: PatchSearchSession;
  request: () => Promise<SearchTextQueryExecutionResult>;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  scheduleSelectedPreview: (selectedIndex: number) => void;
  reportMiss: (requestId: number, missReport: ReturnType<typeof buildTextSearchApplication>["missReport"]) => void;
  now?: () => number;
};

export function runEntitySearchRequest({
  requestId,
  query,
  minimumQueryLength,
  trackQuery,
  clearSearchResults,
  request,
  application,
  patchSearchSession,
  recordUiInteraction,
  reportMiss,
  now = Date.now,
}: EntitySearchRequestRunnerInput) {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < minimumQueryLength) {
    clearSearchResults(normalizedQuery);
    return;
  }
  const startedAt = now();
  void trackQuery<SearchEntityQueryResult>({
    generation: requestId,
    request: request(),
    apply: (result, generation) => {
      recordUiInteraction?.("searchEverywhere", normalizedQuery, startedAt, now());
      const applied = buildEntitySearchApplication({ ...application, query, result });
      patchSearchSession(applied.patch);
      if (applied.missReport) reportMiss(generation, applied.missReport);
    },
  });
}

export function runTextSearchRequest({
  requestId,
  mode,
  query,
  minimumQueryLength,
  trackQuery,
  clearSearchResults,
  patchSearchSession,
  request,
  recordUiInteraction,
  scheduleSelectedPreview,
  reportMiss,
  now = Date.now,
}: TextSearchRequestRunnerInput) {
  patchSearchSession({ candidates: [], truncationNotice: null });
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < minimumQueryLength) {
    clearSearchResults(normalizedQuery);
    return;
  }
  const startedAt = now();
  void trackQuery<SearchTextQueryExecutionResult>({
    generation: requestId,
    request: request(),
    apply: (result, generation) => {
      recordUiInteraction?.(mode === "searchEverywhere" ? "searchEverywhere" : "globalSearch", normalizedQuery, startedAt, now());
      const applied = buildTextSearchApplication({ mode, query, result });
      patchSearchSession(applied.patch);
      scheduleSelectedPreview(applied.previewIndex);
      reportMiss(generation, applied.missReport);
    },
  });
}
