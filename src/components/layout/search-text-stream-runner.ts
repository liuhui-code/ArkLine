import { textSearchPartialNotice } from "@/components/layout/search-everywhere-controller-model";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { TextSearchRequestRunnerInput } from "@/components/layout/search-request-runner";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import {
  parseSearchQuery,
  type WorkspaceTextSearchResult,
  type WorkspaceTextSearchStreamEvent,
  type WorkspaceTextSearchStreamTerminal,
} from "@/features/search/workspace-text-search";
import type { SearchQueryTrackOptions } from "@/features/search/search-interaction-runtime";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchRequest } from "@/features/workspace/workspace-index-api-types";

type TrackQuery = <T>(options: SearchQueryTrackOptions<T>) => Promise<void>;

export type StreamingTextSearchRunnerInput = {
  requestId: number;
  mode: SearchEverywhereMode;
  query: string;
  request: WorkspaceTextSearchRequest;
  stream: (
    request: WorkspaceTextSearchRequest,
    onEvent: (event: WorkspaceTextSearchStreamEvent) => void,
  ) => Promise<WorkspaceTextSearchStreamTerminal>;
  isCurrentQuery: (generation: number) => boolean;
  trackQuery: TrackQuery;
  patchSearchSession: (patch: Partial<SearchSessionSnapshot>) => void;
  scheduleSelectedPreview: (selectedIndex: number) => void;
  reportMiss: TextSearchRequestRunnerInput["reportMiss"];
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  onStreamError?: (message: string) => void;
  now?: () => number;
};

export function runStreamingTextSearch({
  requestId,
  mode,
  query,
  request,
  stream,
  isCurrentQuery,
  trackQuery,
  patchSearchSession,
  scheduleSelectedPreview,
  reportMiss,
  recordUiInteraction,
  onStreamError,
  now = Date.now,
}: StreamingTextSearchRunnerInput) {
  let aggregate = emptyResult(query);
  let firstBatch = true;
  let interactionRecorded = false;
  let nextSequence = 0;
  let terminal = false;
  const startedAt = now();
  patchSearchSession({ candidates: [], truncationNotice: null, textPageLoading: true });

  function failProtocol(message: string) {
    terminal = true;
    patchSearchSession({ textPageLoading: false });
    onStreamError?.(message);
  }

  function finish(event: WorkspaceTextSearchStreamTerminal) {
    if (terminal || event.sequence < nextSequence) return;
    if (event.sequence > nextSequence) {
      failProtocol("Workspace text search stream sequence gap");
      return;
    }
    terminal = true;

    const result = event.status === "complete"
      ? { ...aggregate, partial: false, limitReached: false, nextCursor: null }
      : aggregate;
    patchSearchSession({
      truncationNotice: textSearchPartialNotice(result),
      textNextCursor: result.nextCursor ?? null,
      textPageLoading: false,
    });
    if (!interactionRecorded) {
      recordUiInteraction?.(interactionKind(mode), query.trim(), startedAt, now());
      interactionRecorded = true;
    }
    if (event.status === "failed") {
      onStreamError?.(event.message ?? "Workspace text search failed");
      return;
    }
    if (result.matches.length === 0 && event.status !== "cancelled") {
      reportMiss(requestId, {
        mode,
        query,
        result,
        suppressMissExplain: event.status !== "complete",
      });
    }
  }

  const requestPromise = stream(request, (event) => {
    if (event.generation !== requestId || !isCurrentQuery(requestId) || terminal) return;
    if (event.event === "started") return;
    if (event.event === "batch") {
      if (event.sequence < nextSequence) return;
      if (event.sequence > nextSequence) {
        failProtocol("Workspace text search stream sequence gap");
        return;
      }
      nextSequence += 1;
      aggregate = mergeTextSearchResults(aggregate, event.result);
      patchSearchSession({
        result: aggregate,
        textNextCursor: aggregate.nextCursor ?? null,
        textPageLoading: true,
        ...(firstBatch ? { previewContent: null, selectedIndex: 0 } : {}),
      });
      if (firstBatch && aggregate.matches.length > 0) scheduleSelectedPreview(0);
      firstBatch = false;
      if (!interactionRecorded) {
        recordUiInteraction?.(interactionKind(mode), query.trim(), startedAt, now());
        interactionRecorded = true;
      }
      return;
    }
    finish(event);
  }).then((terminalFromCommand) => {
    if (!isCurrentQuery(requestId) || terminal) return;
    window.setTimeout(() => {
      if (isCurrentQuery(requestId) && !terminal) finish(terminalFromCommand);
    }, 0);
  }).catch((error) => {
    if (isCurrentQuery(requestId)) patchSearchSession({ textPageLoading: false });
    throw error;
  });

  void trackQuery<void>({ generation: requestId, request: requestPromise, apply: () => undefined });
}

export function mergeTextSearchResults(
  current: WorkspaceTextSearchResult,
  incoming: WorkspaceTextSearchResult,
): WorkspaceTextSearchResult {
  const seen = new Set(current.matches.map(matchKey));
  const matches = [...current.matches];
  for (const match of incoming.matches) {
    const key = matchKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    matches.push(match);
  }
  return {
    ...incoming,
    matches,
    searchedFiles: (current.searchedFiles ?? 0) + (incoming.searchedFiles ?? 0),
    prefilterSkippedFiles: (current.prefilterSkippedFiles ?? 0) + (incoming.prefilterSkippedFiles ?? 0),
  };
}

function emptyResult(query: string): WorkspaceTextSearchResult {
  return { query: parseSearchQuery(query), matches: [] };
}

function matchKey(match: WorkspaceTextSearchResult["matches"][number]) {
  return `${match.path}\0${match.line}\0${match.column}`;
}

function interactionKind(mode: SearchEverywhereMode): UiInteractionKind {
  return mode === "searchEverywhere" ? "searchEverywhere" : "globalSearch";
}
