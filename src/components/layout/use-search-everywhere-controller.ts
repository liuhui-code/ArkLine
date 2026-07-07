import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  capSearchEverywhereCandidates,
  orderSearchEverywhereCandidates,
} from "@/components/layout/search-overlay-model";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { filterSearchCandidatesByScope, searchEverywhereEntityCandidates } from "@/components/layout/app-shell-model";
import { SEARCH_EVERYWHERE_DISPLAY_LIMIT } from "@/components/layout/app-shell-constants";
import {
  getRelativeWorkspacePath,
  parseSearchQuery,
  searchWorkspaceText,
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
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

export type UseSearchEverywhereControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorContent: string;
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
  editorContent,
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
  const [searchEverywhereResult, setSearchEverywhereResult] = useState<WorkspaceTextSearchResult>({
    query: { kind: "text", query: "" },
    matches: [],
  });
  const [searchEverywhereCandidates, setSearchEverywhereCandidates] = useState<SearchCandidate[]>([]);
  const [searchEverywhereTruncationNotice, setSearchEverywhereTruncationNotice] = useState<string | null>(null);
  const [searchEverywhereSelectedIndex, setSearchEverywhereSelectedIndex] = useState(0);
  const [searchEverywherePreviewContent, setSearchEverywherePreviewContent] = useState<string | null>(null);
  const searchEverywhereRequestRef = useRef(0);
  const searchPreviewRequestRef = useRef(0);

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
    setQuickOpenQuery(value);
  }

  function resetSearchOverlayState() {
    setDebouncedSearchQuery("");
    setSearchEverywhereSelectedIndex(0);
    setSearchEverywherePreviewContent(null);
  }

  function moveSearchEverywhereSelection(direction: 1 | -1) {
    const resultCount = searchEverywhereMode === "searchEverywhere"
      ? searchEverywhereCandidates.length
      : searchEverywhereResult.matches.length;
    if (resultCount <= 0) return;
    setSearchEverywhereSelectedIndex((current) => {
      const normalized = Math.min(Math.max(current, 0), resultCount - 1);
      return (normalized + direction + resultCount) % resultCount;
    });
  }

  async function openSearchEverywhereResult(path: string, line: number, column: number) {
    rememberCurrentLocation();
    setActiveOverlay("none");
    await navigateToLocation({ path, line, column }, "Usage");
  }

  async function openSearchEverywhereCandidate(candidate: SearchCandidate) {
    if (!candidate.path) return;
    rememberCurrentLocation();
    setActiveOverlay("none");
    await navigateToLocation({
      path: candidate.path,
      line: candidate.line ?? 1,
      column: candidate.column ?? 1,
    }, "Usage");
  }

  async function openSelectedSearchEverywhereResult() {
    if (searchEverywhereMode === "searchEverywhere") {
      const selectedCandidate = searchEverywhereCandidates[searchEverywhereSelectedIndex];
      if (selectedCandidate) await openSearchEverywhereCandidate(selectedCandidate);
      return;
    }
    const selected = searchEverywhereResult.matches[searchEverywhereSelectedIndex];
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
      setDebouncedSearchQuery(quickOpenQuery);
      return;
    }
    const timeout = window.setTimeout(() => setDebouncedSearchQuery(quickOpenQuery), 80);
    return () => window.clearTimeout(timeout);
  }, [activeOverlay, quickOpenQuery]);

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
    editorContent,
    indexVersionKey,
    searchEverywhereMode,
    searchEverywhereOptions,
    searchEverywhereScope,
    workspace,
    workspaceApi,
  ]);

  useEffect(() => {
    if (activeOverlay !== "searchEverywhere" || searchEverywhereMode === "searchEverywhere") {
      setSearchEverywherePreviewContent(null);
      return;
    }
    const selected = searchEverywhereResult.matches[searchEverywhereSelectedIndex];
    if (!selected) {
      setSearchEverywherePreviewContent(null);
      return;
    }
    const requestId = searchPreviewRequestRef.current + 1;
    searchPreviewRequestRef.current = requestId;
    setSearchEverywherePreviewContent(null);
    void readSearchFile(selected.path)
      .then((content) => {
        if (searchPreviewRequestRef.current === requestId) setSearchEverywherePreviewContent(content);
      })
      .catch(() => {
        if (searchPreviewRequestRef.current === requestId) setSearchEverywherePreviewContent(null);
      });
  }, [activeOverlay, activePath, editorContent, searchEverywhereMode, searchEverywhereResult, searchEverywhereSelectedIndex, workspaceApi]);

  function clearSearchResults(query: string) {
    setSearchEverywhereCandidates([]);
    setSearchEverywhereTruncationNotice(null);
    setSearchEverywhereResult({ query: { kind: "text", query }, matches: [] });
    setSearchEverywhereSelectedIndex(0);
  }

  function runEntitySearch(requestId: number) {
    const query = debouncedSearchQuery;
    if (!workspace || !query.trim()) {
      clearSearchResults("");
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
      setSearchEverywhereCandidates(capped.items);
      setSearchEverywhereTruncationNotice(capped.metadata.truncated
        ? `Showing ${capped.metadata.returnedCount} of at least ${capped.metadata.fetchedCount} ${searchEverywhereScope} result(s). Refine the query to see more.`
        : null);
      setSearchEverywhereResult({ query: { kind: "text", query: query.trim() }, matches: [] });
      setSearchEverywhereSelectedIndex(0);
      if (visibleCandidates.length === 0 && query.trim()) explainSearchEverywhereMiss(requestId, query, explain);
    });
  }

  function runTextSearch(requestId: number) {
    if (!workspace) return;
    setSearchEverywhereCandidates([]);
    setSearchEverywhereTruncationNotice(null);
    const query = debouncedSearchQuery;
    if (!query.trim()) {
      clearSearchResults("");
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
      ? indexedText(workspace.rootPath, query, "text", 60).then((envelope) => {
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
      setSearchEverywhereResult(result);
      setSearchEverywherePreviewContent(null);
      setSearchEverywhereSelectedIndex(0);
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
        limit: 60,
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
      limit: 60,
    });
  }

  async function readSearchFile(path: string) {
    if (normalizePath(path) === normalizePath(activePath ?? "")) {
      return getOpenDocumentContent(path) ?? editorContent;
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

  return {
    searchEverywhereMode,
    searchEverywhereScope,
    setSearchEverywhereScope,
    searchEverywhereReplaceQuery,
    setSearchEverywhereReplaceQuery,
    searchEverywhereOptions,
    searchEverywhereResult,
    searchEverywhereCandidates,
    searchEverywhereTruncationNotice,
    searchEverywhereSelectedIndex,
    setSearchEverywhereSelectedIndex,
    searchEverywherePreviewContent,
    openSearchOverlay,
    handleOverlayQueryChange,
    resetSearchOverlayState,
    moveSearchEverywhereSelection,
    openSearchEverywhereResult,
    openSearchEverywhereCandidate,
    openSelectedSearchEverywhereResult,
    toggleSearchEverywhereCaseSensitive,
    toggleSearchEverywhereWholeWord,
  };
}

export function searchOverlayLabel(mode: SearchEverywhereMode) {
  if (mode === "find") return "Find in Files";
  if (mode === "replace") return "Replace in Files";
  return "Search Everywhere";
}

function textSearchInteractionKind(mode: SearchEverywhereMode): UiInteractionKind {
  return mode === "searchEverywhere" ? "searchEverywhere" : "globalSearch";
}

function normalizeSelectedSearchText(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 120) return "";
  return normalized;
}

function textCandidatesToSearchResult(
  rootPath: string,
  query: string,
  candidates: SearchCandidate[],
): WorkspaceTextSearchResult {
  const parsedQuery = parseSearchQuery(query);
  if (parsedQuery.kind !== "text") return { query: parsedQuery, matches: [] };
  return {
    query: parsedQuery,
    matches: candidates.flatMap((candidate) => {
      if (candidate.source !== "text" || !candidate.path || !candidate.line || !candidate.column) return [];
      const preview = candidate.signature ?? candidate.title;
      const previewStart = Math.max(0, candidate.column - 1);
      const previewEnd = Math.min(preview.length, previewStart + parsedQuery.query.length);
      return [{
        path: candidate.path,
        relativePath: getRelativeWorkspacePath(rootPath, candidate.path),
        fileName: getPathBasename(candidate.path),
        line: candidate.line,
        column: candidate.column,
        summary: candidate.title,
        preview,
        previewStart,
        previewEnd,
        contextBefore: [],
        contextAfter: [],
      }];
    }),
  };
}
