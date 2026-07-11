import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  normalizeSelectedSearchText,
  searchOverlayLabel,
  textCandidatesToSearchResult,
  textSearchInteractionKind,
  textSearchPartialNotice,
} from "@/components/layout/search-everywhere-controller-model";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  buildSearchEntityAppendPatch,
  buildSearchEntityPatch,
  executeSearchEntityQuery,
  type SearchEntityQueryResult,
} from "@/components/layout/search-entity-query-session";
import { buildTextSearchAppendPatch } from "@/components/layout/search-pagination-session";
import { useSearchOverlayDebouncedQuery } from "@/components/layout/search-overlay-query-lifecycle";
import {
  openSearchCandidateNavigation,
  openSearchResultNavigation,
} from "@/components/layout/search-navigation-action";
import { SEARCH_EVERYWHERE_DISPLAY_LIMIT } from "@/components/layout/app-shell-constants";
import {
  searchWorkspaceText,
  type WorkspaceTextSearchOptions,
} from "@/features/search/workspace-text-search";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { scheduleSelectedSearchPreview as schedulePreviewSession } from "@/features/search/search-preview-session";
import {
  buildTextSearchResultPatch,
  executeSearchTextQuery,
  planSearchTextQuery,
  shouldExplainTextSearchMiss,
} from "@/features/search/search-text-query-session";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import { searchSessionCompat } from "@/features/search/search-session-compat";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";
import type { WorkspaceApi, WorkspaceIndexQueryScope, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";
import { normalizePath } from "@/features/workspace/workspace-store";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";

const MIN_SEARCH_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS: Record<SearchEverywhereMode, number> = { searchEverywhere: 140, find: 260, replace: 260 };
const SEARCH_PREVIEW_DEBOUNCE_MS = 200;

export type UseSearchEverywhereControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorSelectedText: string;
  quickOpenQuery: string;
  activeOverlay: OverlayKey;
  indexVersionKey: string;
  setQuickOpenQuery: (query: string) => void;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
  queryIndexCandidates: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  getTextSearchPaths: () => string[];
  getRecentPaths: () => string[];
  replaceQueryReadiness: (readiness: WorkspaceIndexReadiness) => void;
  getOpenDocumentContent: (path: string) => string | null;
  getActiveContent: () => string;
  hasDirtyDocuments: () => boolean;
  rememberCurrentLocation: () => void;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  explainIndexMiss: (kind: "search", query: string) => Promise<string | null>;
  recordRecentQueryExplain: (entry: QueryExplainRecordInput) => void;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  onStatusChange: (message: string) => void;
};

export function useSearchEverywhereController({
  workspaceApi,
  workspace,
  activePath,
  editorSelectedText,
  quickOpenQuery,
  activeOverlay,
  indexVersionKey,
  setQuickOpenQuery,
  setActiveOverlay,
  queryIndexCandidates,
  getTextSearchPaths,
  getRecentPaths,
  replaceQueryReadiness,
  getOpenDocumentContent,
  getActiveContent,
  hasDirtyDocuments,
  rememberCurrentLocation,
  navigateToLocation,
  explainIndexMiss,
  recordRecentQueryExplain,
  recordUiInteraction,
  onStatusChange,
}: UseSearchEverywhereControllerOptions) {
  const [searchEverywhereMode, setSearchEverywhereMode] = useState<SearchEverywhereMode>("searchEverywhere");
  const [searchEverywhereScope, setSearchEverywhereScope] = useState<WorkspaceIndexQueryScope>("all");
  const [searchEverywhereReplaceQuery, setSearchEverywhereReplaceQuery] = useState("");
  const [searchEverywhereOptions, setSearchEverywhereOptions] = useState<WorkspaceTextSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
  });
  const searchSessionStoreRef = useRef(createSearchSessionStore());
  const workspaceApiRef = useRef(workspaceApi);
  const workspaceRootRef = useRef<string | null>(workspace?.rootPath ?? null);
  workspaceApiRef.current = workspaceApi;
  workspaceRootRef.current = workspace?.rootPath ?? null;
  const interactionRuntimeRef = useRef(createSearchInteractionRuntime({ cancel: (kind, generation) => {
    const rootPath = workspaceRootRef.current;
    if (!rootPath || !workspaceApiRef.current.cancelWorkspaceSearch) return;
    void workspaceApiRef.current.cancelWorkspaceSearch(rootPath, kind, generation).catch(() => undefined);
  } }));
  const navigationCloseHandledRef = useRef(false);
  const { debouncedSearchQuery, resetDebouncedSearchQuery } = useSearchOverlayDebouncedQuery({
    activeOverlay,
    quickOpenQuery,
    mode: searchEverywhereMode,
    debounceMs: SEARCH_DEBOUNCE_MS,
    navigationCloseHandledRef,
    invalidateSearchSession,
  });

  function openSearchOverlay(mode: SearchEverywhereMode) {
    setSearchEverywhereMode(mode);
    if (mode === "searchEverywhere") {
      setSearchEverywhereScope("all");
      setQuickOpenQuery(normalizeSelectedSearchText(editorSelectedText));
    }
    setActiveOverlay("searchEverywhere");
    if (mode === "find" || mode === "replace") {
      const selectedSearchText = normalizeSelectedSearchText(editorSelectedText);
      if (selectedSearchText) {
        setQuickOpenQuery(selectedSearchText);
      }
    }
  }

  function handleOverlayQueryChange(value: string) {
    invalidateSearchSession();
    setQuickOpenQuery(value);
  }

  function resetSearchOverlayState() {
    const startedAt = Date.now();
    invalidateSearchSession();
    recordUiInteraction?.("searchClose", searchOverlayLabel(searchEverywhereMode), startedAt, Date.now());
    resetDebouncedSearchQuery();
    searchSessionStoreRef.current.patch({ selectedIndex: 0, previewContent: null });
  }

  function moveSearchEverywhereSelection(direction: 1 | -1) {
    const session = searchSessionStoreRef.current.getSnapshot();
    const resultCount = searchEverywhereMode === "searchEverywhere"
      ? session.candidates.length
      : session.result.matches.length;
    if (resultCount <= 0) return;
    const normalized = Math.min(Math.max(session.selectedIndex, 0), resultCount - 1);
    if (
      direction > 0
      && ((searchEverywhereMode === "searchEverywhere" && session.entityNextCursor) || (searchEverywhereMode !== "searchEverywhere" && session.textNextCursor))
      && normalized === resultCount - 1
    ) {
      void loadNextSearchEverywherePage(resultCount);
      return;
    }
    setSearchEverywhereSelectedIndex((normalized + direction + resultCount) % resultCount);
  }

  function setSearchEverywhereSelectedIndex(selectedIndex: number) {
    searchSessionStoreRef.current.patch({ selectedIndex });
    scheduleSelectedPreview(selectedIndex);
  }

  function scheduleSelectedPreview(selectedIndex: number) {
    schedulePreviewSession({
      activeOverlay,
      mode: searchEverywhereMode,
      selectedIndex,
      delayMs: SEARCH_PREVIEW_DEBOUNCE_MS,
      sessionStore: searchSessionStoreRef.current,
      interactionRuntime: interactionRuntimeRef.current,
      readFile: (path) => readSearchFile(path, false),
    });
  }

  async function openSearchEverywhereResult(path: string, line: number, column: number) {
    await openSearchResultNavigation({
      path,
      line,
      column,
      rememberCurrentLocation,
      closeSearchOverlayForNavigation,
      navigateToLocation,
      recordUiInteraction,
    });
  }

  async function openSearchEverywhereCandidate(candidate: SearchCandidate) {
    await openSearchCandidateNavigation({
      candidate,
      rememberCurrentLocation,
      closeSearchOverlayForNavigation,
      navigateToLocation,
      recordUiInteraction,
    });
  }

  async function openSelectedSearchEverywhereResult() {
    const session = searchSessionStoreRef.current.getSnapshot();
    if (searchEverywhereMode === "searchEverywhere") {
      const selectedCandidate = session.candidates[session.selectedIndex];
      if (selectedCandidate) await openSearchEverywhereCandidate(selectedCandidate);
      return;
    }
    const selected = session.result.matches[session.selectedIndex];
    if (selected) await openSearchEverywhereResult(selected.path, selected.line, selected.column);
  }

  function toggleSearchEverywhereCaseSensitive() {
    setSearchEverywhereOptions((current) => ({ ...current, caseSensitive: !current.caseSensitive }));
  }

  function toggleSearchEverywhereWholeWord() {
    setSearchEverywhereOptions((current) => ({ ...current, wholeWord: !current.wholeWord }));
  }

  useEffect(() => {
    if (activeOverlay !== "searchEverywhere") return;
    const requestId = interactionRuntimeRef.current.startQuery(
      searchEverywhereMode === "searchEverywhere" ? "searchEverywhere" : "text",
    );
    if (!workspace) {
      clearSearchResults(debouncedSearchQuery.trim());
      return;
    }
    if (searchEverywhereMode === "searchEverywhere") {
      runEntitySearch(requestId);
      return;
    }
    runTextSearch(requestId);
  }, [
    activeOverlay,
    activePath,
    debouncedSearchQuery,
    indexVersionKey,
    searchEverywhereMode,
    searchEverywhereOptions,
    searchEverywhereScope,
    workspace,
    workspaceApi,
  ]);

  function clearSearchResults(query: string) {
    searchSessionStoreRef.current.clear(query);
  }

  function runEntitySearch(requestId: number) {
    const query = debouncedSearchQuery;
    const normalizedQuery = query.trim();
    if (!workspace || normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      clearSearchResults(normalizedQuery);
      return;
    }
    const startedAt = Date.now();
    void interactionRuntimeRef.current.trackQuery<SearchEntityQueryResult>({
      generation: requestId,
      request: executeSearchEntityQuery({
        runReadiness: workspaceApi.queryWorkspaceCandidatesWithReadiness
          ? () => workspaceApi.queryWorkspaceCandidatesWithReadiness!(workspace.rootPath, query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1)
          : undefined,
        runIndexed: workspaceApi.queryWorkspaceCandidates
          ? () => workspaceApi.queryWorkspaceCandidates!(workspace.rootPath, query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1)
          : undefined,
        runLegacy: workspaceApi.queryWorkspaceSearchEverywhere
          ? () => workspaceApi.queryWorkspaceSearchEverywhere!(workspace.rootPath, query, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1)
          : undefined,
        runLocal: () => queryIndexCandidates(query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1),
        scope: searchEverywhereScope,
        onReadiness: (envelope) => {
          replaceQueryReadiness(envelope.readiness);
        },
      }),
      apply: ({ candidates, explain, nextCursor }, requestId) => {
        recordUiInteraction?.("searchEverywhere", query.trim(), startedAt, Date.now());
        const { patch, visibleCount } = buildSearchEntityPatch({
          candidates,
          query,
          scope: searchEverywhereScope,
          displayLimit: SEARCH_EVERYWHERE_DISPLAY_LIMIT,
          activePath,
          recentPaths: getRecentPaths(),
          nextCursor,
          readinessCursorAvailable: Boolean(workspaceApi.queryWorkspaceCandidatesWithReadiness),
        });
        searchSessionStoreRef.current.patch(patch);
        if (visibleCount === 0 && query.trim()) explainSearchEverywhereMiss(requestId, query, explain);
      },
    });
  }

  function runTextSearch(requestId: number) {
    if (!workspace) return;
    searchSessionStoreRef.current.patch({ candidates: [], truncationNotice: null });
    const query = debouncedSearchQuery;
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < MIN_SEARCH_QUERY_LENGTH) {
      clearSearchResults(normalizedQuery);
      return;
    }
    const startedAt = Date.now();
    const dirty = hasDirtyDocuments();
    const indexedText = workspaceApi.queryWorkspaceCandidatesWithReadiness;
    const plan = planSearchTextQuery({
      query,
      minimumQueryLength: MIN_SEARCH_QUERY_LENGTH,
      options: searchEverywhereOptions,
      dirty,
      indexedAvailable: Boolean(indexedText),
    });
    if (plan.kind === "clear") {
      clearSearchResults(plan.query);
      return;
    }

    void interactionRuntimeRef.current.trackQuery({
      generation: requestId,
      request: executeSearchTextQuery({
        plan,
        runIndexed: () => indexedText!(workspace.rootPath, query, "text", 50),
        runFallback: () => fallbackTextSearch(query, dirty, requestId),
        convertIndexed: (items) => textCandidatesToSearchResult(workspace.rootPath, query, items),
        onIndexedReadiness: replaceQueryReadiness,
      }),
      apply: ({ result, suppressMissExplain }, requestId) => {
        recordUiInteraction?.(textSearchInteractionKind(searchEverywhereMode), query.trim(), startedAt, Date.now());
        searchSessionStoreRef.current.patch({
          ...buildTextSearchResultPatch(result),
          truncationNotice: textSearchPartialNotice(result),
        });
        scheduleSelectedPreview(0);
        if (shouldExplainTextSearchMiss(result, suppressMissExplain, query)) {
          const missLabel = searchOverlayLabel(searchEverywhereMode);
          void explainIndexMiss("search", query.trim()).then((explanation) => {
            if (interactionRuntimeRef.current.isCurrentQuery(requestId) && explanation) {
              onStatusChange(`${missLabel} miss: ${explanation}`);
            }
          });
        }
      },
    });
  }

  async function loadNextSearchEverywherePage(selectIndexAfterLoad?: number) {
    const session = searchSessionStoreRef.current.getSnapshot();
    if (!workspace || session.textPageLoading) return;
    const query = debouncedSearchQuery;
    const requestId = interactionRuntimeRef.current.getCurrentQueryGeneration();
    if (searchEverywhereMode === "searchEverywhere") {
      if (!session.entityNextCursor || !workspaceApi.queryWorkspaceCandidatesWithReadiness) return;
      searchSessionStoreRef.current.patch({ textPageLoading: true });
      const envelope = await workspaceApi.queryWorkspaceCandidatesWithReadiness(workspace.rootPath, query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT, session.entityNextCursor);
      if (!interactionRuntimeRef.current.isCurrentQuery(requestId)) return;
      searchSessionStoreRef.current.patch(buildSearchEntityAppendPatch(
        session.candidates,
        envelope.items,
        envelope.nextCursor,
        selectIndexAfterLoad ?? session.selectedIndex,
      ));
      return;
    }
    if (!session.textNextCursor) return;
    searchSessionStoreRef.current.patch({ textPageLoading: true });
    const result = await fallbackTextSearch(query, hasDirtyDocuments(), requestId, session.textNextCursor);
    if (!interactionRuntimeRef.current.isCurrentQuery(requestId)) return;
    searchSessionStoreRef.current.patch(buildTextSearchAppendPatch(session, result, selectIndexAfterLoad));
    if (selectIndexAfterLoad != null) scheduleSelectedPreview(selectIndexAfterLoad);
  }

  function fallbackTextSearch(
    query: string,
    dirty: boolean,
    generation: number,
    cursor: Parameters<typeof searchWorkspaceText>[0]["cursor"] = null,
  ) {
    const canUseNativeTextSearch = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (workspace && canUseNativeTextSearch && workspaceApi.searchWorkspaceText && !dirty) {
      return workspaceApi.searchWorkspaceText({
        query,
        generation,
        cursor,
        rootPath: workspace.rootPath,
        options: searchEverywhereOptions,
        limit: 50,
        contextLines: 2,
      });
    }
    return searchWorkspaceText({
      query,
      rootPath: workspace?.rootPath ?? "",
      paths: getTextSearchPaths(),
      options: searchEverywhereOptions,
      readFile: async (path) => {
        try {
          return await readSearchFile(path);
        } catch {
          return null;
        }
      },
      limit: 50,
      cursor,
    });
  }

  function invalidateSearchSession(cancelRunning = true) {
    interactionRuntimeRef.current.invalidateForeground({ cancelActive: cancelRunning });
    searchSessionStoreRef.current.patch({ previewContent: null, textPageLoading: false });
  }

  function closeSearchOverlayForNavigation() {
    invalidateSearchSession();
    navigationCloseHandledRef.current = true;
    setActiveOverlay("none");
  }

  async function readSearchFile(path: string, allowBackendRead = true) {
    if (normalizePath(path) === normalizePath(activePath ?? "")) {
      return getOpenDocumentContent(path) ?? getActiveContent();
    }
    const openContent = getOpenDocumentContent(path);
    if (openContent != null || !allowBackendRead) return openContent;
    return await workspaceApi.openFile(path);
  }

  function explainSearchEverywhereMiss(requestId: number, query: string, explain?: string[]) {
    const envelopeExplanation = formatQueryEnvelopeExplain(explain);
    if (envelopeExplanation) {
      const message = `Search Everywhere miss: ${envelopeExplanation}`;
      recordRecentQueryExplain({ kind: "search", query: query.trim(), message, explain });
      onStatusChange(message);
      return;
    }
    void explainIndexMiss("search", query.trim()).then((explanation) => {
      if (interactionRuntimeRef.current.isCurrentQuery(requestId) && explanation) {
        onStatusChange(`Search Everywhere miss: ${explanation}`);
      }
    });
  }

  return searchSessionCompat({
    searchEverywhereMode,
    searchEverywhereScope,
    setSearchEverywhereScope,
    searchEverywhereReplaceQuery,
    setSearchEverywhereReplaceQuery,
    searchEverywhereOptions,
    searchSessionStore: searchSessionStoreRef.current,
    setSearchEverywhereSelectedIndex,
    openSearchOverlay,
    handleOverlayQueryChange,
    resetSearchOverlayState,
    moveSearchEverywhereSelection,
    openSearchEverywhereResult,
    openSearchEverywhereCandidate,
    openSelectedSearchEverywhereResult,
    loadNextSearchEverywherePage,
    toggleSearchEverywhereCaseSensitive,
    toggleSearchEverywhereWholeWord,
  }, searchSessionStoreRef.current);
}
