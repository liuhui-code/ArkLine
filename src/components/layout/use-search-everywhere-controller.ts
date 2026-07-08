import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  capSearchEverywhereCandidates,
  orderSearchEverywhereCandidates,
} from "@/components/layout/search-overlay-model";
import {
  normalizeSelectedSearchText,
  searchOverlayLabel,
  textCandidatesToSearchResult,
  textSearchInteractionKind,
  textSearchPartialNotice,
} from "@/components/layout/search-everywhere-controller-model";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { filterSearchCandidatesByScope, searchEverywhereEntityCandidates } from "@/components/layout/app-shell-model";
import { SEARCH_EVERYWHERE_DISPLAY_LIMIT } from "@/components/layout/app-shell-constants";
import {
  parseSearchQuery,
  searchWorkspaceText,
  type WorkspaceTextSearchOptions,
} from "@/features/search/workspace-text-search";
import { scheduleSearchPreview } from "@/features/search/search-preview-loader";
import { createSearchSessionStore } from "@/features/search/search-session-store";
import { searchSessionCompat } from "@/features/search/search-session-compat";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";
import type {
  WorkspaceApi,
  WorkspaceIndexQueryScope,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";
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
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [searchEverywhereMode, setSearchEverywhereMode] = useState<SearchEverywhereMode>("searchEverywhere");
  const [searchEverywhereScope, setSearchEverywhereScope] = useState<WorkspaceIndexQueryScope>("all");
  const [searchEverywhereReplaceQuery, setSearchEverywhereReplaceQuery] = useState("");
  const [searchEverywhereOptions, setSearchEverywhereOptions] = useState<WorkspaceTextSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
  });
  const searchSessionStoreRef = useRef(createSearchSessionStore());
  const searchEverywhereRequestRef = useRef(0);
  const searchPreviewRequestRef = useRef(0);
  const navigationCloseHandledRef = useRef(false);

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
    invalidateSearchSession(false);
    setQuickOpenQuery(value);
  }

  function resetSearchOverlayState() {
    const startedAt = Date.now();
    invalidateSearchSession();
    recordUiInteraction?.("searchClose", searchOverlayLabel(searchEverywhereMode), startedAt, Date.now());
    setDebouncedSearchQuery("");
    searchSessionStoreRef.current.patch({ selectedIndex: 0, previewContent: null });
  }

  function moveSearchEverywhereSelection(direction: 1 | -1) {
    const session = searchSessionStoreRef.current.getSnapshot();
    const resultCount = searchEverywhereMode === "searchEverywhere"
      ? session.candidates.length
      : session.result.matches.length;
    if (resultCount <= 0) return;
    const normalized = Math.min(Math.max(session.selectedIndex, 0), resultCount - 1);
    setSearchEverywhereSelectedIndex((normalized + direction + resultCount) % resultCount);
  }

  function setSearchEverywhereSelectedIndex(selectedIndex: number) {
    searchSessionStoreRef.current.patch({ selectedIndex });
    scheduleSelectedPreview(selectedIndex);
  }

  function scheduleSelectedPreview(selectedIndex: number) {
    if (activeOverlay !== "searchEverywhere" || searchEverywhereMode === "searchEverywhere") {
      searchSessionStoreRef.current.patch({ previewContent: null });
      return;
    }
    const selected = searchSessionStoreRef.current.getSnapshot().result.matches[selectedIndex];
    if (!selected) {
      searchSessionStoreRef.current.patch({ previewContent: null });
      return;
    }
    const requestId = searchPreviewRequestRef.current + 1;
    searchPreviewRequestRef.current = requestId;
    searchSessionStoreRef.current.patch({ previewContent: null });
    scheduleSearchPreview({
      path: selected.path,
      requestId,
      delayMs: SEARCH_PREVIEW_DEBOUNCE_MS,
      readFile: readSearchFile,
      isCurrent: (id) => searchPreviewRequestRef.current === id,
      onPreview: (content) => searchSessionStoreRef.current.patch({ previewContent: content }),
    });
  }

  async function openSearchEverywhereResult(path: string, line: number, column: number) {
    const startedAt = Date.now();
    rememberCurrentLocation();
    closeSearchOverlayForNavigation();
    await navigateToLocation({ path, line, column }, "Usage");
    recordUiInteraction?.("searchJump", getPathBasename(path), startedAt, Date.now());
  }

  async function openSearchEverywhereCandidate(candidate: SearchCandidate) {
    if (!candidate.path) return;
    const startedAt = Date.now();
    rememberCurrentLocation();
    closeSearchOverlayForNavigation();
    await navigateToLocation({
      path: candidate.path,
      line: candidate.line ?? 1,
      column: candidate.column ?? 1,
    }, "Usage");
    recordUiInteraction?.("searchJump", candidate.title, startedAt, Date.now());
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
    if (activeOverlay !== "searchEverywhere") {
      if (navigationCloseHandledRef.current) {
        navigationCloseHandledRef.current = false;
      } else {
        invalidateSearchSession();
      }
      setDebouncedSearchQuery(quickOpenQuery);
      return;
    }
    const timeout = window.setTimeout(() => setDebouncedSearchQuery(quickOpenQuery), SEARCH_DEBOUNCE_MS[searchEverywhereMode]);
    return () => window.clearTimeout(timeout);
  }, [activeOverlay, quickOpenQuery, searchEverywhereMode]);

  useEffect(() => {
    if (activeOverlay !== "searchEverywhere") return;
    const requestId = searchEverywhereRequestRef.current + 1;
    searchEverywhereRequestRef.current = requestId;

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
    const indexRequest: Promise<{ candidates: SearchCandidate[]; explain?: string[] }> = workspaceApi.queryWorkspaceCandidatesWithReadiness
      ? workspaceApi.queryWorkspaceCandidatesWithReadiness(workspace.rootPath, query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1)
        .then((envelope) => {
          replaceQueryReadiness(envelope.readiness);
          return { candidates: envelope.items, explain: envelope.explain };
        })
      : workspaceApi.queryWorkspaceCandidates
      ? workspaceApi.queryWorkspaceCandidates(workspace.rootPath, query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1).then((candidates) => ({ candidates }))
      : workspaceApi.queryWorkspaceSearchEverywhere
      ? workspaceApi.queryWorkspaceSearchEverywhere(workspace.rootPath, query, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1)
        .then((candidates) => filterSearchCandidatesByScope(candidates, searchEverywhereScope))
        .then((candidates) => ({ candidates }))
      : Promise.resolve({ candidates: queryIndexCandidates(query, searchEverywhereScope, SEARCH_EVERYWHERE_DISPLAY_LIMIT + 1) });

    void indexRequest.then(({ candidates, explain }) => {
      if (searchEverywhereRequestRef.current !== requestId) return;
      recordUiInteraction?.("searchEverywhere", query.trim(), startedAt, Date.now());
      const visibleCandidates = searchEverywhereEntityCandidates(candidates);
      const ordered = orderSearchEverywhereCandidates(visibleCandidates, {
        activePath,
        recentPaths: getRecentPaths(),
      });
      const capped = capSearchEverywhereCandidates(ordered, {
        scope: searchEverywhereScope,
        displayLimit: SEARCH_EVERYWHERE_DISPLAY_LIMIT,
      });
      searchSessionStoreRef.current.patch({
        candidates: capped.items,
        truncationNotice: capped.metadata.truncated
        ? `Showing ${capped.metadata.returnedCount} of at least ${capped.metadata.fetchedCount} ${searchEverywhereScope} result(s). Refine the query to see more.`
        : null,
        result: { query: { kind: "text", query: query.trim() }, matches: [] },
        selectedIndex: 0,
        previewContent: null,
      });
      if (visibleCandidates.length === 0 && query.trim()) explainSearchEverywhereMiss(requestId, query, explain);
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
    const parsedTextQuery = parseSearchQuery(query);
    const indexedText = workspaceApi.queryWorkspaceCandidatesWithReadiness;
    const canUseIndexedTextFacade = indexedText
      && parsedTextQuery.kind === "text"
      && Boolean(parsedTextQuery.query)
      && !searchEverywhereOptions.caseSensitive
      && !searchEverywhereOptions.wholeWord
      && !dirty;
    const searchRequest = canUseIndexedTextFacade
      ? indexedText(workspace.rootPath, query, "text", 50).then((envelope) => {
        replaceQueryReadiness(envelope.readiness);
        if (envelope.readiness.state === "missing" && envelope.items.length === 0) {
          return fallbackTextSearch(query, dirty, requestId).then((result) => ({ result, suppressMissExplain: false }));
        }
        return {
          result: textCandidatesToSearchResult(workspace.rootPath, query, envelope.items),
          suppressMissExplain: envelope.readiness.state !== "ready",
        };
      })
      : fallbackTextSearch(query, dirty, requestId).then((result) => ({ result, suppressMissExplain: false }));

    void searchRequest.then(({ result, suppressMissExplain }) => {
      if (searchEverywhereRequestRef.current !== requestId) return;
      recordUiInteraction?.(textSearchInteractionKind(searchEverywhereMode), query.trim(), startedAt, Date.now());
      searchSessionStoreRef.current.patch({
        result,
        truncationNotice: textSearchPartialNotice(result),
        previewContent: null,
        selectedIndex: 0,
      });
      scheduleSelectedPreview(0);
      if (!suppressMissExplain && result.query.kind !== "invalid" && result.matches.length === 0 && query.trim()) {
        const missLabel = searchOverlayLabel(searchEverywhereMode);
        void explainIndexMiss("search", query.trim()).then((explanation) => {
          if (searchEverywhereRequestRef.current === requestId && explanation) {
            onStatusChange(`${missLabel} miss: ${explanation}`);
          }
        });
      }
    });
  }

  function fallbackTextSearch(query: string, dirty: boolean, generation: number) {
    const canUseNativeTextSearch = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
    if (workspace && canUseNativeTextSearch && workspaceApi.searchWorkspaceText && !dirty) {
      return workspaceApi.searchWorkspaceText({
        query,
        generation,
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
    });
  }

  function invalidateSearchSession(cancelRunning = true) {
    const previousGeneration = searchEverywhereRequestRef.current;
    searchEverywhereRequestRef.current += 1;
    searchPreviewRequestRef.current += 1;
    if (cancelRunning && previousGeneration > 0) cancelSearchGeneration(previousGeneration);
  }

  function cancelSearchGeneration(generation: number) {
    if (!workspace?.rootPath || !workspaceApi.cancelWorkspaceSearch) {
      return;
    }
    const kind = searchEverywhereMode === "searchEverywhere" ? "searchEverywhere" : "text";
    void workspaceApi.cancelWorkspaceSearch(workspace.rootPath, kind, generation).catch(() => undefined);
  }

  function closeSearchOverlayForNavigation() {
    invalidateSearchSession();
    navigationCloseHandledRef.current = true;
    setActiveOverlay("none");
  }

  async function readSearchFile(path: string) {
    if (normalizePath(path) === normalizePath(activePath ?? "")) {
      return getOpenDocumentContent(path) ?? getActiveContent();
    }
    const openContent = getOpenDocumentContent(path);
    return openContent ?? await workspaceApi.openFile(path);
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
      if (searchEverywhereRequestRef.current === requestId && explanation) {
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
    toggleSearchEverywhereCaseSensitive,
    toggleSearchEverywhereWholeWord,
  }, searchSessionStoreRef.current);
}
