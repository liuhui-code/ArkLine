import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  textCandidatesToSearchResult,
} from "@/components/layout/search-everywhere-controller-model";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  resolveSearchSelectionMove,
} from "@/components/layout/search-pagination-session";
import { useSearchOverlayDebouncedQuery } from "@/components/layout/search-overlay-query-lifecycle";
import {
  openSearchCandidateNavigation,
  openSearchResultNavigation,
  openSelectedSearchNavigation,
} from "@/components/layout/search-navigation-action";
import {
  closeSearchOverlayForNavigationAction,
  handleSearchOverlayQueryChangeAction,
  openSearchOverlayAction,
  resetSearchOverlayStateAction,
} from "@/components/layout/search-overlay-actions";
import { buildSearchEverywhereControllerResult } from "@/components/layout/search-controller-result";
import { SEARCH_EVERYWHERE_DISPLAY_LIMIT } from "@/components/layout/app-shell-constants";
import {
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchCursor,
} from "@/features/search/workspace-text-search";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { scheduleSelectedSearchPreview as schedulePreviewSession } from "@/features/search/search-preview-session";
import {
  buildSearchTextQueryRequest,
  executeSearchTextQuery,
  planSearchTextQuery,
} from "@/features/search/search-text-query-session";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import type { WorkspaceApi, WorkspaceIndexQueryScope, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import {
  reportSearchEverywhereMiss,
  reportTextSearchMiss,
} from "@/components/layout/search-miss-reporting";
import {
  runTextSearchRequest,
} from "@/components/layout/search-request-runner";
import {
  canUseNativeTextSearchRuntime,
  readSearchFileForSearch,
  runFallbackTextSearch,
} from "@/components/layout/search-text-fallback";
import { loadNextSearchPage } from "@/components/layout/search-next-page-loader";
import { runSearchEntityQuery } from "@/components/layout/search-entity-runner";

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
    openSearchOverlayAction({
      mode,
      editorSelectedText,
      setSearchEverywhereMode,
      setSearchEverywhereScope,
      setQuickOpenQuery,
      setActiveOverlay,
    });
  }

  function handleOverlayQueryChange(value: string) {
    handleSearchOverlayQueryChangeAction({ value, invalidateSearchSession, setQuickOpenQuery });
  }

  function resetSearchOverlayState() {
    resetSearchOverlayStateAction({
      mode: searchEverywhereMode,
      invalidateSearchSession,
      resetDebouncedSearchQuery,
      patchSearchSession: searchSessionStoreRef.current.patch,
      recordUiInteraction,
    });
  }

  function moveSearchEverywhereSelection(direction: 1 | -1) {
    const session = searchSessionStoreRef.current.getSnapshot();
    const resultCount = searchEverywhereMode === "searchEverywhere"
      ? session.candidates.length
      : session.result.matches.length;
    const move = resolveSearchSelectionMove({
      mode: searchEverywhereMode,
      direction,
      selectedIndex: session.selectedIndex,
      resultCount,
      canLoadMore: searchEverywhereMode === "searchEverywhere" ? Boolean(session.entityNextCursor) : Boolean(session.textNextCursor),
    });
    if (move.kind === "loadMore") {
      void loadNextSearchEverywherePage(move.selectIndexAfterLoad);
      return;
    }
    if (move.kind === "select") setSearchEverywhereSelectedIndex(move.selectedIndex);
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
    await openSelectedSearchNavigation({
      mode: searchEverywhereMode,
      selectedIndex: session.selectedIndex,
      candidates: session.candidates,
      matches: session.result.matches,
      rememberCurrentLocation,
      closeSearchOverlayForNavigation,
      navigateToLocation,
      recordUiInteraction,
    });
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
    runSearchEntityQuery({
      requestId,
      query: debouncedSearchQuery,
      rootPath: workspace?.rootPath ?? null,
      scope: searchEverywhereScope,
      displayLimit: SEARCH_EVERYWHERE_DISPLAY_LIMIT,
      minimumQueryLength: MIN_SEARCH_QUERY_LENGTH,
      activePath,
      recentPaths: getRecentPaths(),
      queryIndexCandidates,
      workspaceApi,
      replaceQueryReadiness,
      trackQuery: interactionRuntimeRef.current.trackQuery,
      clearSearchResults,
      patchSearchSession: searchSessionStoreRef.current.patch,
      recordUiInteraction,
      reportMiss: (requestId, missReport) => {
        void reportSearchEverywhereMiss({
          requestId,
          query: missReport.query,
          explain: missReport.explain,
          isCurrentQuery: interactionRuntimeRef.current.isCurrentQuery,
          explainIndexMiss,
          recordRecentQueryExplain,
          onStatusChange,
        });
      },
    });
  }

  function runTextSearch(requestId: number) {
    if (!workspace) return;
    searchSessionStoreRef.current.patch({ candidates: [], truncationNotice: null });
    const query = debouncedSearchQuery;
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

    runTextSearchRequest({
      requestId,
      mode: searchEverywhereMode,
      query,
      minimumQueryLength: MIN_SEARCH_QUERY_LENGTH,
      trackQuery: interactionRuntimeRef.current.trackQuery,
      clearSearchResults,
      patchSearchSession: searchSessionStoreRef.current.patch,
      request: () => executeSearchTextQuery(buildSearchTextQueryRequest({
        plan,
        rootPath: workspace.rootPath,
        query,
        generation: requestId,
        runIndexed: (rootPath, query, scope, limit) => indexedText!(rootPath, query, scope, limit),
        runFallback: (query, generation) => fallbackTextSearch(query, dirty, generation),
        convertIndexed: (items) => textCandidatesToSearchResult(workspace.rootPath, query, items),
        onIndexedReadiness: replaceQueryReadiness,
      })),
      recordUiInteraction,
      scheduleSelectedPreview,
      reportMiss: (requestId, missReport) => {
        void reportTextSearchMiss({
          requestId,
          ...missReport,
          isCurrentQuery: interactionRuntimeRef.current.isCurrentQuery,
          explainIndexMiss,
          onStatusChange,
        });
      },
    });
  }

  async function loadNextSearchEverywherePage(selectIndexAfterLoad?: number) {
    const session = searchSessionStoreRef.current.getSnapshot();
    await loadNextSearchPage({
      mode: searchEverywhereMode,
      session,
      rootPath: workspace?.rootPath ?? null,
      query: debouncedSearchQuery,
      scope: searchEverywhereScope,
      displayLimit: SEARCH_EVERYWHERE_DISPLAY_LIMIT,
      requestId: interactionRuntimeRef.current.getCurrentQueryGeneration(),
      selectIndexAfterLoad,
      queryEntityPage: workspaceApi.queryWorkspaceCandidatesWithReadiness,
      runTextPage: fallbackTextSearch,
      hasDirtyDocuments,
      isCurrentQuery: interactionRuntimeRef.current.isCurrentQuery,
      patchSearchSession: searchSessionStoreRef.current.patch,
      scheduleSelectedPreview,
    });
  }

  function fallbackTextSearch(
    query: string,
    dirty: boolean,
    generation: number,
    cursor: WorkspaceTextSearchCursor | null = null,
  ) {
    return runFallbackTextSearch({
      query,
      dirty,
      generation,
      cursor,
      rootPath: workspace?.rootPath ?? "",
      options: searchEverywhereOptions,
      paths: getTextSearchPaths(),
      canUseNativeTextSearch: canUseNativeTextSearchRuntime(),
      searchNative: workspaceApi.searchWorkspaceText,
      readFile: (path) => readSearchFile(path),
    });
  }

  function invalidateSearchSession(cancelRunning = true) {
    interactionRuntimeRef.current.invalidateForeground({ cancelActive: cancelRunning });
    searchSessionStoreRef.current.patch({ previewContent: null, textPageLoading: false });
  }

  function closeSearchOverlayForNavigation() {
    closeSearchOverlayForNavigationAction({
      navigationCloseHandledRef,
      invalidateSearchSession,
      setActiveOverlay,
    });
  }

  async function readSearchFile(path: string, allowBackendRead = true) {
    return await readSearchFileForSearch({
      path,
      activePath,
      getOpenDocumentContent,
      getActiveContent,
      openFile: workspaceApi.openFile,
      allowBackendRead,
    });
  }

  return buildSearchEverywhereControllerResult({
    state: { searchEverywhereMode, searchEverywhereScope, searchEverywhereReplaceQuery, searchEverywhereOptions },
    actions: { setSearchEverywhereScope, setSearchEverywhereReplaceQuery, setSearchEverywhereSelectedIndex, openSearchOverlay, handleOverlayQueryChange, resetSearchOverlayState, moveSearchEverywhereSelection, openSearchEverywhereResult, openSearchEverywhereCandidate, openSelectedSearchEverywhereResult, loadNextSearchEverywherePage, toggleSearchEverywhereCaseSensitive, toggleSearchEverywhereWholeWord },
    searchSessionStore: searchSessionStoreRef.current,
  });
}
