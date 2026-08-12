import {
  useEffect,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { OverlaySurface } from "@/components/layout/OverlaySurface";
import { SearchOverlayContent } from "@/components/layout/SearchOverlayContent";
import { useQuickOpenController } from "@/components/layout/use-quick-open-controller";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import {
  createWorkspaceIndexStore,
} from "@/features/workspace/workspace-index-store";
import type { DocumentRuntimeStore } from "@/features/documents/document-runtime-store";

type WorkspaceIndexStore = ReturnType<typeof createWorkspaceIndexStore>;

type SearchWorkspaceOverlayControllerProps = {
  activeOverlay: OverlayKey;
  workspace: WorkspaceViewModel | null;
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  workspaceIndex: WorkspaceIndexStore;
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  tabsRef: MutableRefObject<{ state: { recentFiles: string[]; openTabs: { path: string }[] } }>;
  getActiveContent: () => string;
  getEditorSelectedText: () => string;
  indexVersionKey: string;
  partialNotice: string | null;
  onClose: () => void;
  onOpenQuickOpen: () => void;
  onSetActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
  onOpenFile: (path: string) => Promise<unknown>;
  rememberCurrentLocation: () => void;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  explainIndexMiss: (kind: "search", query: string) => Promise<string | null>;
  recordRecentQueryExplain: Parameters<typeof useSearchEverywhereController>[0]["recordRecentQueryExplain"];
  recordUiInteraction: NonNullable<Parameters<typeof useSearchEverywhereController>[0]["recordUiInteraction"]>;
  onStatusChange: (message: string) => void;
  registerActions: (actions: {
    reset: () => void;
    openQuickOpen: () => void;
    open: (mode: SearchEverywhereMode, query?: string) => void;
  }) => void;
};

export function SearchWorkspaceOverlayController(props: SearchWorkspaceOverlayControllerProps) {
  const [query, setQuery] = useState("");
  const {
    searchEverywhereMode,
    searchEverywhereScope,
    setSearchEverywhereScope,
    searchEverywhereReplaceQuery,
    setSearchEverywhereReplaceQuery,
    searchEverywhereOptions,
    searchSessionStore,
    setSearchEverywhereSelectedIndex,
    openSearchOverlay,
    handleOverlayQueryChange,
    handleOverlayQueryDraftChange,
    resetSearchOverlayState,
    moveSearchEverywhereSelection,
    openSearchEverywhereResult,
    openSearchEverywhereCandidate,
    openSelectedSearchEverywhereResult,
    loadNextSearchEverywherePage,
    toggleSearchEverywhereCaseSensitive,
    toggleSearchEverywhereWholeWord,
  } = useSearchEverywhereController({
    workspaceApi: props.workspaceApi,
    workspace: props.workspace,
    activePath: props.activePath,
    getEditorSelectedText: props.getEditorSelectedText,
    quickOpenQuery: query,
    activeOverlay: props.activeOverlay,
    indexVersionKey: props.indexVersionKey,
    setQuickOpenQuery: setQuery,
    setActiveOverlay: props.onSetActiveOverlay,
    queryIndexCandidates: (query, scope, limit) => props.workspaceIndex.queryCandidates(query, scope, limit),
    getTextSearchPaths: props.workspaceIndex.getTextSearchPaths,
    getDirtyDocumentPaths: () => props.documentsRef.current.getDocuments()
      .filter((document) => document.isDirty)
      .map((document) => document.path),
    getRecentPaths: () => props.tabsRef.current.state.recentFiles,
    getOpenedPaths: () => props.tabsRef.current.state.openTabs.map((tab) => tab.path),
    replaceQueryReadiness: (indexReadiness) => searchSessionStore.patch({ indexReadiness }),
    getOpenDocumentContent: (path) => props.documentsRef.current.getDocument(path)?.currentContent ?? null,
    getActiveContent: props.getActiveContent,
    hasDirtyDocuments: () => props.documentsRef.current.hasDirtyDocuments(),
    rememberCurrentLocation: props.rememberCurrentLocation,
    navigateToLocation: props.navigateToLocation,
    explainIndexMiss: props.explainIndexMiss,
    recordRecentQueryExplain: props.recordRecentQueryExplain,
    recordUiInteraction: props.recordUiInteraction,
    onStatusChange: props.onStatusChange,
    loadFileContent: (path) => props.workspaceApi.openFile(path),
  });
  const quickOpen = useQuickOpenController({
    active: props.activeOverlay === "quickOpen",
    rootPath: props.workspace?.rootPath ?? null,
    query,
    localResults: [],
    queryLocal: (value) => props.workspaceIndex.queryQuickOpen(value, 8).flatMap((candidate) => candidate.path ? [{ path: candidate.path }] : []),
    queryWorkspace: props.workspaceApi.queryWorkspaceQuickOpen,
    queryWorkspaceWithReadiness: props.workspaceApi.queryWorkspaceCandidatesWithReadiness,
    cancelWorkspaceSearch: props.workspaceApi.cancelWorkspaceSearch,
    onError: props.onStatusChange,
  });

  useEffect(() => {
    props.registerActions({
      reset: () => {
        setQuery("");
        resetSearchOverlayState();
      },
      openQuickOpen: () => {
        props.onOpenQuickOpen();
      },
      open: (mode, initialQuery) => {
        openSearchOverlay(mode);
        if (initialQuery !== undefined) setQuery(initialQuery);
      },
    });
  }, [openSearchOverlay, props, resetSearchOverlayState]);

  if (props.activeOverlay !== "quickOpen" && props.activeOverlay !== "searchEverywhere") {
    return null;
  }

  const label = props.activeOverlay === "quickOpen" ? "Quick Open" : searchEverywhereMode === "find"
    ? "Find in Files" : searchEverywhereMode === "replace" ? "Replace in Files" : "Search Everywhere";
  return (
    <OverlaySurface activeOverlay={props.activeOverlay} label={label} onClose={props.onClose} searchMode={searchEverywhereMode}>
      <SearchOverlayContent
        activeOverlay={props.activeOverlay}
        commandPaletteItems={[]}
        quickOpenQuery={query}
        quickOpenResults={quickOpen.results}
        quickOpenSelectedIndex={quickOpen.selectedIndex}
        recentFileResults={[]}
        recentProjectResults={[]}
        searchEverywhereOptions={searchEverywhereOptions}
        searchEverywhereMode={searchEverywhereMode}
        searchEverywhereScope={searchEverywhereScope}
        searchEverywhereReplaceQuery={searchEverywhereReplaceQuery}
        searchSessionStore={searchSessionStore}
        workspacePartialNotice={props.partialNotice}
        onChangeQuery={handleOverlayQueryChange}
        onDraftQueryChange={handleOverlayQueryDraftChange}
        onChangeSearchEverywhereScope={setSearchEverywhereScope}
        onChangeSearchEverywhereReplaceQuery={setSearchEverywhereReplaceQuery}
        onOpenFile={(path) => void props.onOpenFile(path)}
        onMoveQuickOpenSelection={quickOpen.moveSelection}
        onSelectQuickOpenResult={quickOpen.setSelectedIndex}
        onOpenSearchEverywhereResult={(result) => void openSearchEverywhereResult(result.path, result.line, result.column)}
        onOpenSearchEverywhereCandidate={(candidate) => void openSearchEverywhereCandidate(candidate)}
        onLoadNextSearchEverywherePage={() => void loadNextSearchEverywherePage()}
        onOpenProject={() => undefined}
        onMoveSearchEverywhereSelection={moveSearchEverywhereSelection}
        onOpenSelectedSearchEverywhereResult={() => void openSelectedSearchEverywhereResult()}
        onSelectSearchEverywhereResult={setSearchEverywhereSelectedIndex}
        onToggleSearchEverywhereCaseSensitive={toggleSearchEverywhereCaseSensitive}
        onToggleSearchEverywhereWholeWord={toggleSearchEverywhereWholeWord}
        onSubmitGoToLine={() => undefined}
        onCloseOverlay={props.onClose}
      />
    </OverlaySurface>
  );
}
