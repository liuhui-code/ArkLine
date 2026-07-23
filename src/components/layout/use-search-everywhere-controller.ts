import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { useSearchOverlayDebouncedQuery } from "@/components/layout/search-overlay-query-lifecycle";
import { buildSearchEverywhereControllerResult } from "@/components/layout/search-controller-result";
import { SEARCH_EVERYWHERE_DISPLAY_LIMIT } from "@/components/layout/app-shell-constants";
import {
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchCursor,
} from "@/features/search/workspace-text-search";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import type { WorkspaceApi, WorkspaceIndexQueryScope, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import {
  canUseNativeTextSearchRuntime,
} from "@/components/layout/search-text-fallback";
import { dispatchSearchOverlayQueryEffect } from "@/components/layout/search-query-effect-dispatcher";
import {
  createSearchFileReader,
} from "@/components/layout/search-file-reader";
import { createWorkspaceSearchInteractionRuntime } from "@/components/layout/search-workspace-runtime";
import {
  moveSearchSelection,
  setSearchSelection,
} from "@/components/layout/search-selection-actions";
import { createSearchMissReporters } from "@/components/layout/search-miss-reporters";
import { createSearchOpenActions } from "@/components/layout/search-open-actions";
import { runSearchFallbackText } from "@/components/layout/search-fallback-runner";
import { createSearchSessionLifecycle } from "@/components/layout/search-session-lifecycle";
import { createSearchNextPageAction } from "@/components/layout/search-next-page-action";
import { createSearchRunActions } from "@/components/layout/search-run-actions";
import { createSearchPreviewAction } from "@/components/layout/search-preview-action";
import { createSearchControllerContext } from "@/components/layout/search-controller-context";
import { createSearchOverlayCommandActions } from "@/components/layout/search-overlay-command-actions";

const MIN_SEARCH_QUERY_LENGTH = 2;
const SEARCH_PREVIEW_DEBOUNCE_MS = 200;

export type UseSearchEverywhereControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  getEditorSelectedText: () => string;
  quickOpenQuery: string;
  activeOverlay: OverlayKey;
  indexVersionKey: string;
  setQuickOpenQuery: (query: string) => void;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
  queryIndexCandidates: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  getTextSearchPaths: () => string[];
  getRecentPaths: () => string[];
  getOpenedPaths: () => string[];
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
  loadFileContent?: (path: string) => Promise<string>;
};

export function useSearchEverywhereController({
  workspaceApi,
  workspace,
  activePath,
  getEditorSelectedText,
  quickOpenQuery,
  activeOverlay,
  indexVersionKey,
  setQuickOpenQuery,
  setActiveOverlay,
  queryIndexCandidates,
  getTextSearchPaths,
  getRecentPaths,
  getOpenedPaths,
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
  loadFileContent,
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
  const interactionRuntimeRef = useRef(createWorkspaceSearchInteractionRuntime({
    getRootPath: () => workspaceRootRef.current,
    getWorkspaceApi: () => workspaceApiRef.current,
    onError: (error) => {
      onStatusChange(
        `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    },
  }));
  const navigationCloseHandledRef = useRef(false);
  const searchLifecycle = createSearchSessionLifecycle({
    interactionRuntime: interactionRuntimeRef.current,
    sessionStore: searchSessionStoreRef.current,
    navigationCloseHandledRef,
    setActiveOverlay,
  });
  const { invalidateSearchSession, closeSearchOverlayForNavigation } = searchLifecycle;
  const { debouncedSearchQuery, resetDebouncedSearchQuery } = useSearchOverlayDebouncedQuery({
    activeOverlay,
    quickOpenQuery,
    mode: searchEverywhereMode,
    navigationCloseHandledRef,
    invalidateSearchSession,
  });
  const readSearchFile = createSearchFileReader({
    activePath,
    getOpenDocumentContent,
    getActiveContent,
    openFile: loadFileContent ?? workspaceApi.openFile,
  });
  const searchContext = createSearchControllerContext({
    getMode: () => searchEverywhereMode,
    getQuery: () => debouncedSearchQuery,
    getRootPath: () => workspace?.rootPath ?? null,
    getScope: () => searchEverywhereScope,
    getOptions: () => searchEverywhereOptions,
  });
  const scheduleSelectedPreview = createSearchPreviewAction({
    getActiveOverlay: () => activeOverlay,
    getMode: searchContext.getMode,
    delayMs: SEARCH_PREVIEW_DEBOUNCE_MS,
    sessionStore: searchSessionStoreRef.current,
    interactionRuntime: interactionRuntimeRef.current,
    readFile: readSearchFile,
  });
  const searchMissReporters = createSearchMissReporters({
    isCurrentQuery: interactionRuntimeRef.current.isCurrentQuery,
    explainIndexMiss,
    recordRecentQueryExplain,
    onStatusChange,
  });
  const searchOpenActions = createSearchOpenActions({
    mode: searchEverywhereMode,
    sessionStore: searchSessionStoreRef.current,
    rememberCurrentLocation,
    closeSearchOverlayForNavigation,
    navigateToLocation,
    recordUiInteraction,
  });
  const loadNextSearchPageAction = createSearchNextPageAction({
    getMode: searchContext.getMode,
    sessionStore: searchSessionStoreRef.current,
    getRootPath: searchContext.getRootPath,
    getQuery: searchContext.getQuery,
    getScope: searchContext.getScope,
    getRankingContext: () => ({ activePath, recentPaths: getRecentPaths(), openedPaths: getOpenedPaths() }),
    displayLimit: SEARCH_EVERYWHERE_DISPLAY_LIMIT,
    interactionRuntime: interactionRuntimeRef.current,
    queryEntityPage: workspaceApi.queryWorkspaceCandidatesWithReadiness,
    runTextPage: fallbackTextSearch,
    hasDirtyDocuments,
    scheduleSelectedPreview,
  });
  const searchRunActions = createSearchRunActions({
    getQuery: searchContext.getQuery,
    getRootPath: searchContext.getRootPath,
    getMode: searchContext.getMode,
    getScope: searchContext.getScope,
    getOptions: searchContext.getOptions,
    getDirty: hasDirtyDocuments,
    displayLimit: SEARCH_EVERYWHERE_DISPLAY_LIMIT,
    minimumQueryLength: MIN_SEARCH_QUERY_LENGTH,
    activePath,
    recentPaths: getRecentPaths(),
    openedPaths: getOpenedPaths(),
    queryIndexCandidates,
    workspaceApi,
    replaceQueryReadiness,
    trackQuery: interactionRuntimeRef.current.trackQuery,
    clearSearchResults,
    patchSearchSession: searchSessionStoreRef.current.patch,
    recordUiInteraction,
    scheduleSelectedPreview,
    reportEntityMiss: searchMissReporters.reportEntityMiss,
    reportTextMiss: searchMissReporters.reportTextMiss,
    runFallback: fallbackTextSearch,
  });
  const searchOverlayCommands = createSearchOverlayCommandActions({
    mode: searchEverywhereMode,
    getEditorSelectedText,
    invalidateSearchSession,
    resetDebouncedSearchQuery,
    patchSearchSession: searchSessionStoreRef.current.patch,
    recordUiInteraction,
    setSearchEverywhereMode,
    setSearchEverywhereScope,
    setQuickOpenQuery,
    setActiveOverlay,
    setSearchEverywhereOptions,
  });

  function openSearchOverlay(mode: SearchEverywhereMode) {
    searchOverlayCommands.openSearchOverlay(mode);
  }

  function handleOverlayQueryChange(value: string) {
    searchOverlayCommands.handleOverlayQueryChange(value);
  }

  function handleOverlayQueryDraftChange(_value: string) {
    interactionRuntimeRef.current.invalidateForeground({ cancelActive: true });
  }

  function resetSearchOverlayState() {
    searchOverlayCommands.resetSearchOverlayState();
  }

  function moveSearchEverywhereSelection(direction: 1 | -1) {
    moveSearchSelection({
      mode: searchEverywhereMode,
      direction,
      sessionStore: searchSessionStoreRef.current,
      scheduleSelectedPreview,
      loadNextPage: (selectedIndex) => void loadNextSearchEverywherePage(selectedIndex),
    });
  }

  function setSearchEverywhereSelectedIndex(selectedIndex: number) {
    setSearchSelection({
      selectedIndex,
      sessionStore: searchSessionStoreRef.current,
      scheduleSelectedPreview,
    });
  }

  async function openSearchEverywhereResult(path: string, line: number, column: number) {
    await searchOpenActions.openResult(path, line, column);
  }

  async function openSearchEverywhereCandidate(candidate: SearchCandidate) {
    await searchOpenActions.openCandidate(candidate);
  }

  async function openSelectedSearchEverywhereResult() {
    await searchOpenActions.openSelected();
  }

  function toggleSearchEverywhereCaseSensitive() {
    searchOverlayCommands.toggleSearchEverywhereCaseSensitive();
  }

  function toggleSearchEverywhereWholeWord() {
    searchOverlayCommands.toggleSearchEverywhereWholeWord();
  }

  useEffect(() => {
    dispatchSearchOverlayQueryEffect({
      activeOverlay,
      mode: searchEverywhereMode,
      query: debouncedSearchQuery,
      hasWorkspace: Boolean(workspace),
      startQuery: interactionRuntimeRef.current.startQuery,
      clearSearchResults,
      runEntitySearch,
      runTextSearch,
    });
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
    searchRunActions.runEntitySearch(requestId);
  }

  function runTextSearch(requestId: number) {
    searchRunActions.runTextSearch(requestId);
  }

  async function loadNextSearchEverywherePage(selectIndexAfterLoad?: number) {
    await loadNextSearchPageAction(selectIndexAfterLoad);
  }

  function fallbackTextSearch(
    query: string,
    dirty: boolean,
    generation: number,
    cursor: WorkspaceTextSearchCursor | null = null,
  ) {
    return runSearchFallbackText({
      query,
      dirty,
      generation,
      cursor,
      rootPath: workspace?.rootPath ?? "",
      options: searchEverywhereOptions,
      paths: getTextSearchPaths(),
      canUseNativeTextSearch: canUseNativeTextSearchRuntime(),
      searchNative: workspaceApi.searchWorkspaceText,
      readFile: readSearchFile,
    });
  }

  return buildSearchEverywhereControllerResult({
    state: { searchEverywhereMode, searchEverywhereScope, searchEverywhereReplaceQuery, searchEverywhereOptions },
    actions: { setSearchEverywhereScope, setSearchEverywhereReplaceQuery, setSearchEverywhereSelectedIndex, openSearchOverlay, handleOverlayQueryChange, handleOverlayQueryDraftChange, resetSearchOverlayState, moveSearchEverywhereSelection, openSearchEverywhereResult, openSearchEverywhereCandidate, openSelectedSearchEverywhereResult, loadNextSearchEverywherePage, toggleSearchEverywhereCaseSensitive, toggleSearchEverywhereWholeWord },
    searchSessionStore: searchSessionStoreRef.current,
  });
}
