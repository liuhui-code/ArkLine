import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { getAppShellDerivedState } from "@/components/layout/app-shell-derived-state";
import { AppShellOverlays } from "@/components/layout/AppShellOverlays";
import { AppShellMainLayout } from "@/components/layout/AppShellMainLayout";
import { AppShellToolWindows } from "@/components/layout/AppShellToolWindows";
import { useAppShellCommands } from "@/components/layout/use-app-shell-commands";
import { useAppShellActionRefs } from "@/components/layout/use-app-shell-action-refs";
import { useActiveDocumentActions } from "@/components/layout/use-active-document-actions";
import { useActiveDocumentProjection } from "@/components/layout/use-active-document-projection";
import { useActiveWorkspaceSessionPersistence } from "@/components/layout/use-active-workspace-session-persistence";
import { useBuildControllerState } from "@/components/layout/use-build-controller-state";
import { useCodeActionsWorkspaceEditController } from "@/components/layout/use-code-actions-workspace-edit-controller";
import { useProjectOpening } from "@/components/layout/use-project-opening";
import { useGitAndDiffController } from "@/components/layout/use-git-and-diff-controller";
import { useGitBranchController } from "@/components/layout/use-git-branch-controller";
import { useSourceControlController } from "@/components/layout/use-source-control-controller";
import { useGitDocumentSafety } from "@/components/layout/use-git-document-safety";
import { createActiveDocumentRuntime } from "@/features/documents/active-document-runtime";
import { useEditorDocuments } from "@/components/layout/use-editor-documents";
import { useEditorNavigation } from "@/components/layout/use-editor-navigation";
import { useEditorSurfaceController } from "@/components/layout/use-editor-surface-controller";
import { useEditorTabActions } from "@/components/layout/use-editor-tab-actions";
import { useCurrentFileSymbolsController } from "@/components/layout/use-current-file-symbols-controller";
import { useIndexDiagnosticsController } from "@/components/layout/use-index-diagnostics-controller";
import { useProblemsController } from "@/components/layout/use-problems-controller";
import { useProjectTreeActions } from "@/components/layout/use-project-tree-actions";
import { useSearchEverywhereController } from "@/components/layout/use-search-everywhere-controller";
import { useSettingsController } from "@/components/layout/use-settings-controller";
import { useShellLayoutState } from "@/components/layout/use-shell-layout-state";
import { useShellTransientActions } from "@/components/layout/use-shell-transient-actions";
import { useUsagesController } from "@/components/layout/use-usages-controller";
import { useWorkspaceResetController } from "@/components/layout/use-workspace-reset-controller";
import { useWorkspaceSession } from "@/components/layout/use-workspace-session";
import { useWorkspaceIndexWatchers } from "@/components/layout/use-workspace-index-watchers";
import { useQuickOpenController } from "@/components/layout/use-quick-open-controller";
import { useWorkspaceOpeningController } from "@/components/layout/use-workspace-opening-controller";
import { useSemanticState } from "@/features/semantic/use-semantic-state";
import { createSettingsStore } from "@/features/settings/settings-store";
import { useDefinitionController } from "@/components/layout/use-definition-controller";
import { idleUsageSearchState } from "@/features/workspace/usage-search";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";
import { useWorkspaceQueryExplains } from "@/features/workspace/use-workspace-query-explains";
import { createWorkspaceIndexStore, type WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { getPathBasename } from "@/features/workspace/workspace-store";
import { recordRenderPressure, useUiLatencyMonitor } from "@/features/performance/use-ui-latency-monitor";
import { createEditorSelectionRuntime } from "@/features/editor/editor-selection-runtime";
import { createDocumentLoadCoordinator } from "@/features/documents/document-load-coordinator";
import { createStatusMessageStore } from "@/features/status/status-message-store";
import { createSemanticDocumentSyncQueue } from "@/features/semantic/semantic-document-sync";
import { createCodeMirrorSignatureHelpBroker } from "@/components/layout/codemirror-signature-help-broker";
import { createCodeMirrorCompletionBroker, createCodeMirrorCompletionResolver, createCodeMirrorCompletionResultReporter } from "@/components/layout/codemirror-completion-broker";
type AppShellProps = { workspaceApi?: WorkspaceApi };
export function AppShell({ workspaceApi = defaultWorkspaceApi }: AppShellProps) {
  const canUseNativeProjectPicker = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const statusMessageStore = useMemo(() => createStatusMessageStore("Mode: shell bootstrap"), []);
  const onStatusChange = statusMessageStore.setMessage;
  const [editorFocusToken, setEditorFocusToken] = useState(0);
  const [editorCompletionTarget, setEditorCompletionTarget] = useState<{ action: "open" | "close"; nonce: number } | null>(null);
  const [selectionTarget, setSelectionTarget] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [insertTextTarget, setInsertTextTarget] = useState<{ text: string; replaceBefore?: number; nonce: number } | null>(null);
  const editorSelectionRuntimeRef = useRef(createEditorSelectionRuntime());
  const documentLoadCoordinatorRef = useRef(createDocumentLoadCoordinator());
  const semanticDocumentSyncRef = useRef(createSemanticDocumentSyncQueue(workspaceApi));
  const editorSelection = editorSelectionRuntimeRef.current.selection;

  function requestEditorCompletion(action: "open" | "close") {
    setEditorCompletionTarget((current) => ({ action, nonce: (current?.nonce ?? 0) + 1 }));
  }

  function closeEditorCompletion() {
    requestEditorCompletion("close");
  }

  function openEditorCompletion() {
    if (settingsApplying) {
      onStatusChange("SDK settings are still applying");
      return;
    }
    if (!workspace || !activePath) {
      onStatusChange("Completion unavailable");
      return;
    }
    setActiveOverlay("none");
    requestEditorCompletion("open");
    onStatusChange("Completion");
  }
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const { recentQueryExplains, recordRecentQueryExplain } = useWorkspaceQueryExplains();
  const { recordUiInteraction, uiLatencySamples, renderPressureSamples, ipcLatencySamples } = useUiLatencyMonitor();
  recordRenderPressure("AppShell");
  const settingsRef = useRef(createSettingsStore());
  const workspaceIndexRef = useRef(createWorkspaceIndexStore());
  const [workspaceIndexState, setWorkspaceIndexState] = useState<WorkspaceIndexState>(() => ({ ...workspaceIndexRef.current.state }));
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const { searchActionsRef, settingsActionsRef, gitActionsRef, editorActionsRef, workspaceOpeningActionsRef, projectOpeningActionsRef } = useAppShellActionRefs();
  const { documentsRef, tabsRef, openTabs, activePath, syncTabs, setActiveDocument, resetTabs } = useEditorDocuments();
  const activeContentReader = createActiveDocumentRuntime(documentsRef, () => activePath);
  const { getActiveContent } = activeContentReader;
  const activeDocumentProjection = useActiveDocumentProjection({ documentsRef, activePath });
  function updateEditorSelection(selection: { line: number; column: number; selectedText?: string }) {
    editorSelectionRuntimeRef.current.update(selection);
  }
  const { focusEditor, focusEditorSoon, rememberCurrentLocation, navigateToLocation, navigateBackFromHistory } = useEditorNavigation({
    activePath,
    editorSelection,
    editorSurfaceRef,
    openFile: (path, interaction) => editorActionsRef.current.openFile(path, interaction),
    cancelPendingOpen: () => editorActionsRef.current.cancelPendingOpen(),
    setSelectionTarget,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    onStatusChange,
    recordUiInteraction,
  });
  const { closeActiveFile, closeEditorTab, closeOtherEditorTabs, closeEditorTabsToRight, copyEditorTabPath, copyActiveEditorPath } = useEditorTabActions({
    tabsRef,
    activePath,
    syncTabs,
    setActiveDocument,
    resetTransientEditorTargets: () => {
      closeEditorCompletion();
      setInsertTextTarget(null);
      setSelectionTarget(null);
    },
    onStatusChange,
    onFocusEditorSoon: focusEditorSoon,
  });
  const { filesVisible, setFilesVisible, leftSidebarWidth, bottomContentVisible, setBottomContentVisible, bottomToolHeight, bottomLayoutToken, activeLeftTool, activeBottomTool, activeOverlay, setActiveOverlay, quickOpenQuery, setQuickOpenQuery, filesPaneRef, bottomToolWindowRef, maxBottomToolHeight, resizeBottomToolWindow, resizeLeftSidebar, toggleBottomToolMaxHeight, showLeftTool, showBottomTool, toggleBottomTool, hideBottomToolWindow, setOverlay } = useShellLayoutState({
    onBeforeOverlay: closeEditorCompletion,
    onResetOverlaySearch: () => searchActionsRef.current.resetSearchOverlayState(),
    onStatusChange,
    onFocusEditorSoon: focusEditorSoon,
  });
  const { problems, resetProblems, refreshProblems, runLint, replaceBuildProblems } = useProblemsController({
    workspaceApi,
    activePath,
    getActiveContent,
    showProblems: () => showBottomTool("problems"),
    onStatusChange,
  });
  const { formatActiveDocument, saveActiveDocument } = useActiveDocumentActions({
    activePath,
    documentsRef,
    syncTabs,
    saveFile: workspaceApi.saveFile,
    getFormatOnSave: () => settingsRef.current.state.settings.validation.formatOnSave,
    refreshProblems,
    showProblems: () => showBottomTool("problems"),
    refreshBlame: () => gitActionsRef.current.refreshGitBlame(),
    onStatusChange,
  });
  const { projectTreeChildren, projectTreeLoadingPaths, selectedProjectPath, setSelectedProjectPath, resetProjectTree, loadProjectDirectory, loadProjectDirectoryForWorkspace } = useProjectTreeActions({
    workspaceApi,
    onStatusChange,
  });
  const { workspace, setWorkspace, recentProjects, setRecentProjects, syncWorkspaceIndex, applyWorkspaceIndexRefreshResult, applyWorkspaceSnapshot: applyWorkspaceSessionSnapshot, includeVisibleWorkspaceFile } = useWorkspaceSession({
    workspaceApi,
    onOpenWorkspaceIndex: (nextWorkspace) => {
      workspaceIndexRef.current.openWorkspace(nextWorkspace);
      startTransition(() => setWorkspaceIndexState({ ...workspaceIndexRef.current.state }));
    },
    onIncludeWorkspaceIndexPath: (path) => {
      workspaceIndexRef.current.includeFilePath(path);
      startTransition(() => setWorkspaceIndexState({ ...workspaceIndexRef.current.state }));
    },
    onReplaceWorkspaceIndexState: (state) => {
      workspaceIndexRef.current.replaceState(state);
      startTransition(() => setWorkspaceIndexState({ ...workspaceIndexRef.current.state }));
    },
    onPersistRecentProjects: (next) => {
      settingsRef.current.update({ recentProjects: next });
      void workspaceApi.saveSettings(settingsRef.current.state.settings);
    },
    onStatusChange,
  });
  const gitDocumentSafety = useGitDocumentSafety({ rootPath: workspace?.rootPath, documentsRef, tabsRef, syncTabs, setActiveDocument, saveFile: workspaceApi.saveFile, readFile: workspaceApi.openFile, listWorkspaceDirectory: workspaceApi.listWorkspaceDirectory, invalidateDocumentCache: (path) => documentLoadCoordinatorRef.current.invalidate(path), onDocumentChanged: (path, content) => semanticDocumentSyncRef.current.change(path, content, workspace?.rootPath), onDocumentClosed: (path) => { semanticDocumentSyncRef.current.close(path); if (path === activePath) { closeEditorCompletion(); setSelectionTarget(null); setInsertTextTarget(null); } } });
  const workspaceRootRef = useRef<string | null>(null);
  workspaceRootRef.current = workspace?.rootPath ?? null;
  const signatureHelpBroker = useMemo(() => createCodeMirrorSignatureHelpBroker({ workspaceApi, getRootPath: () => workspaceRootRef.current }), [workspaceApi]);
  const completionBroker = useMemo(() => createCodeMirrorCompletionBroker({
    workspaceApi,
    getRootPath: () => workspaceRootRef.current,
    ensureSemanticDocument: (path, document) => semanticDocumentSyncRef.current.ensure(path, document),
    onResult: createCodeMirrorCompletionResultReporter(onStatusChange, recordRecentQueryExplain),
  }), [onStatusChange, recordRecentQueryExplain, workspaceApi]);
  const completionResolver = useMemo(() => createCodeMirrorCompletionResolver(workspaceApi), [workspaceApi]);
  const { semanticState, refreshSemanticState } = useSemanticState(workspaceApi);
  const { buildState, buildProject, loadBuildConfigurationsForRoot, updateBuildState, saveBuildConfiguration, copyBuildConfiguration, deleteBuildConfiguration, selectBuildConfiguration, runBuild, stopBuild } = useBuildControllerState({
    workspace,
    workspaceApi,
    activePath,
    selectedProjectPath,
    sdkSettings: settingsRef.current.state.settings.sdk,
    showBuild: () => showBottomTool("build"),
    replaceBuildProblems,
    onStatusChange,
  });
  const { settingsVisible, settingsSaveState, settingsApplyState, settingsApplying, environmentReport, editorAppearance, terminalSettings, clearSettingsSaveResetTimer, refreshEnvironmentReport, openSettings, closeSettings, pickSettingsPath, applySettings } = useSettingsController({
    workspaceApi,
    settingsRef,
    refreshSemanticState,
    indexSdkSymbolsForSettings: (settings) => settingsActionsRef.current.indexSdkSymbolsForSettings(settings),
    onSettingsApplied: (settings) => {
      setRecentProjects((current) => (
        current.length > 0 && settings.recentProjects.length === 0 ? current : [...settings.recentProjects]
      ));
      setSettingsHydrated(true);
    },
    onBeforeApply: closeEditorCompletion,
    onStatusChange,
  });
  const { latestExplainResult, latestExplainContext, indexExplainPanelVisible, setIndexExplainPanelVisible, indexDiagnosticsVisible, setIndexDiagnosticsVisible, indexDiagnosticsSectionTarget, indexDiagnosticsLoading, indexDiagnostics, currentFileReadiness, layerReadiness, workspaceIndexTaskStatuses, workspaceIndexStatusSummary, recordWorkspaceIndexTaskStatus, refreshWorkspaceIndexTaskStatuses, refreshIndexDiagnostics, openIndexDiagnostics, resumeIndexingFromDiagnostics, rebuildProjectIndexFromDiagnostics, rebuildSdkIndexFromDiagnostics, indexCurrentFileFromDiagnostics, indexSdkSymbolsForSettings, explainIndexMiss, rebuildIndexFromExplainPanel, openSettingsFromExplainPanel, retryLatestExplainQuery } = useIndexDiagnosticsController({
    workspaceApi,
    workspace,
    workspaceIndexState,
    activePath,
    applyWorkspaceIndexRefreshResult,
    openSettings,
    retryDefinitionQuery: (selection) => void goToDefinitionFromEditor(selection, "keyboard"),
    retrySearchQuery: (query) => {
      setQuickOpenQuery(query);
      openSearchOverlay("searchEverywhere");
    },
    onStatusChange,
  });
  settingsActionsRef.current.indexSdkSymbolsForSettings = indexSdkSymbolsForSettings;
  const { searchEverywhereMode, searchEverywhereScope, setSearchEverywhereScope, searchEverywhereReplaceQuery, setSearchEverywhereReplaceQuery, searchEverywhereOptions, searchSessionStore, setSearchEverywhereSelectedIndex, openSearchOverlay, handleOverlayQueryChange, handleOverlayQueryDraftChange, resetSearchOverlayState, moveSearchEverywhereSelection, openSearchEverywhereResult, openSearchEverywhereCandidate, openSelectedSearchEverywhereResult, loadNextSearchEverywherePage, toggleSearchEverywhereCaseSensitive, toggleSearchEverywhereWholeWord } = useSearchEverywhereController({
    workspaceApi,
    workspace,
    activePath,
    getEditorSelectedText: editorSelectionRuntimeRef.current.getSelectedText,
    quickOpenQuery,
    activeOverlay,
    indexVersionKey: `${workspaceIndexState.indexedAt ?? ""}:${workspaceIndexState.status}`,
    setQuickOpenQuery,
    setActiveOverlay,
    queryIndexCandidates: (query, scope, limit) => workspaceIndexRef.current.queryCandidates(query, scope, limit),
    getTextSearchPaths: () => workspaceIndexRef.current.getTextSearchPaths(),
    getDirtyDocumentPaths: () => documentsRef.current.getDocuments()
      .filter((document) => document.isDirty)
      .map((document) => document.path),
    getRecentPaths: () => tabsRef.current.state.recentFiles,
    getOpenedPaths: () => tabsRef.current.state.openTabs.map((tab) => tab.path),
    replaceQueryReadiness: (readiness) => {
      workspaceIndexRef.current.replaceQueryReadiness(readiness);
      startTransition(() => setWorkspaceIndexState({ ...workspaceIndexRef.current.state }));
    },
    getOpenDocumentContent: (path) => documentsRef.current.getDocument(path)?.currentContent ?? null,
    getActiveContent,
    hasDirtyDocuments: () => documentsRef.current.hasDirtyDocuments(),
    rememberCurrentLocation,
    navigateToLocation,
    explainIndexMiss,
    recordRecentQueryExplain,
    recordUiInteraction,
    onStatusChange,
    loadFileContent: (path) => documentLoadCoordinatorRef.current.load(path, workspaceApi.openFile),
  });
  searchActionsRef.current.resetSearchOverlayState = resetSearchOverlayState;
  const { currentMethodsVisible, currentMethodsQuery, setCurrentMethodsQuery, currentMethodsSelectedIndex, setCurrentMethodsSelectedIndex, visibleCurrentClassMethods, showCurrentClassMethods, hideCurrentClassMethods, closeCurrentClassMethods, openCurrentClassMethod } = useCurrentFileSymbolsController({
    workspaceApi,
    rootPath: workspace?.rootPath,
    activePath,
    getEditorLine: editorSelectionRuntimeRef.current.getLine,
    getActiveContent,
    onBeforeShow: () => setActiveOverlay("none"),
    rememberCurrentLocation,
    setSelectionTarget,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    focusEditorSoon,
    onStatusChange,
  });
  const { codeActionsVisible, codeActions, codeActionsStatus, codeActionsMessage, codeActionsSelectedIndex, setCodeActionsSelectedIndex, workspaceEditPreview, workspaceEditApplyState, workspaceEditMessage, projectMutationDialog, setProjectMutationDialog, resetCodeActions, resetWorkspaceEdit, resetCodeActionSession, closeCodeActionsPalette, closeWorkspaceEditPreview, applyWorkspaceEditPreview, openProjectMutationDialog, openRootProjectMutationDialog, submitProjectMutationDialog, showCodeActionsFromEditor, resolveCodeActionFromPalette } = useCodeActionsWorkspaceEditController({
    workspace,
    workspaceApi,
    activePath,
    editorSelection,
    settingsApplying,
    getActiveContent,
    documentsRef,
    tabsRef,
    setWorkspace,
    syncTabs,
    syncWorkspaceIndex,
    setActiveDocument,
    closeCompletion: closeEditorCompletion,
    closeOverlay: () => setActiveOverlay("none"),
    hideCurrentClassMethods,
    focusEditorSoon,
    onStatusChange,
  });
  const { openFile, restoreFile, cancelPendingOpen, submitGoToLine, handleEditorChange, handleEditorDocumentChange, handleEditorSelectionChange } = useEditorSurfaceController({
    workspaceApi,
    activePath,
    quickOpenQuery,
    documentsRef,
    tabsRef,
    syncTabs,
    setActiveDocument,
    includeVisibleWorkspaceFile,
    closeCompletion: closeEditorCompletion,
    resetCodeActionSession,
    setEditorSelection: updateEditorSelection,
    setInsertTextTarget,
    setSelectionTarget,
    setActiveOverlay,
    setQuickOpenQuery,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    rememberCurrentLocation,
    focusEditorSoon,
    onStatusChange,
    documentLoadCoordinator: documentLoadCoordinatorRef.current,
    semanticDocumentSync: semanticDocumentSyncRef.current,
  });
  editorActionsRef.current.openFile = openFile;
  editorActionsRef.current.cancelPendingOpen = cancelPendingOpen;
  const { usageSearch, setUsageSearch, queryPanelVisible, openEditorQueryPanel, closeEditorQueryPanel, findUsagesFromEditor, openUsageResult } = useUsagesController({
    workspaceApi,
    workspace,
    activePath,
    editorSelection,
    ...activeContentReader,
    settingsApplying,
    rememberCurrentLocation,
    navigateToUsage: (item) => navigateToLocation({ path: item.path, line: item.line, column: item.column }, "Usage"),
    recordRecentQueryExplain,
    onStatusChange,
  });
  const { definitionDebugText, goToDefinitionFromEditor } = useDefinitionController({
    workspaceApi,
    workspace,
    activePath,
    editorSelection,
    ...activeContentReader,
    settingsApplying,
    openEditorQueryPanel,
    setUsageSearch,
    rememberCurrentLocation,
    navigateToLocation,
    explainIndexMiss,
    recordRecentQueryExplain,
    onStatusChange,
  });
  const activeDocument = activePath ? documentsRef.current.getDocument(activePath) : undefined;
  const { diffFiles, diffActionContext, diffComparison, gitToolView, setGitToolView, gitTraceState, currentLineBlame, gitBlameVisible, gitBlameMenuOpen, selectedBlameAttribution, setSelectedBlameAttribution, toggleGitBlame, toggleGitBlameMenu, refreshGitBlame, closeGitBlame, showCurrentLineBlame, selectGitBlameLine, showSelectedBlameDiff, showSelectedBlameCommit, showSelectedLocalDiff, copySelectedBlameHash, loadDiff, openGitTraceCommitDiff, closeTransientGitUi, resetDiff } = useGitAndDiffController({
    workspaceRootPath: workspace?.rootPath ?? null,
    workspaceApi,
    activePath,
    editorSelectionRuntime: editorSelectionRuntimeRef.current,
    getActiveText: getActiveContent,
    getBaseText: () => activeDocument?.originalContent ?? getActiveContent(),
    gitToolVisible: bottomContentVisible && activeBottomTool === "git",
    showGit: () => showBottomTool("git"),
    setEditorSelection: updateEditorSelection,
    focusEditor,
    onStatusChange,
  });
  gitActionsRef.current.refreshGitBlame = refreshGitBlame;
  const sourceControl = useSourceControlController({ active: filesVisible && activeLeftTool === "git", rootPath: workspace?.rootPath ?? null, workspaceApi, onOpenDiff: openGitTraceCommitDiff, onStatusChange, ...gitDocumentSafety });
  const projectOpening = useProjectOpening({ canUseNativeProjectPicker, hasWorkspace: workspace !== null, workspaceApi, workspaceRootPath: workspace?.rootPath ?? null, openWorkspace: (rootPath) => workspaceOpeningActionsRef.current.openWorkspace(rootPath), focusEditorSoon, onBeforeProjectOpen: () => setActiveOverlay("none"), onStatusChange });
  projectOpeningActionsRef.current.setProjectPathInput = projectOpening.setProjectPathInput;
  projectOpeningActionsRef.current.setProjectOpenError = projectOpening.setProjectOpenError;
  const { resetWorkspaceUi } = useWorkspaceResetController({
    resetTabs,
    resetProjectSelection: () => setSelectedProjectPath(null),
    resetActiveDocument: () => setActiveDocument(null),
    resetQuickOpen: () => setQuickOpenQuery(""),
    resetProjectPicker: () => {
      projectOpening.closeProjectPicker();
      projectOpening.setProjectPathInput("");
    },
    resetOverlay: () => setActiveOverlay("none"),
    resetProblems,
    resetDiff,
    resetCodeActions,
    resetWorkspaceEdit,
    closeCompletion: closeEditorCompletion,
    resetUsageSearch: () => setUsageSearch(idleUsageSearchState()),
    resetEditorState: () => {
      updateEditorSelection({ line: 1, column: 1 });
      setInsertTextTarget(null);
      setSelectionTarget(null);
    },
    resetDocumentCache: () => documentLoadCoordinatorRef.current.clear(),
    showBottomContent: () => setBottomContentVisible(true),
    onStatusChange,
  });
  const { closeTransientUi, hideActiveToolWindow, enterEditorOnlyMode } = useShellTransientActions({
    closeTransientGitUi,
    codeActionsVisible,
    closeCodeActionsPalette,
    workspaceEditPreviewOpen: Boolean(workspaceEditPreview),
    closeWorkspaceEditPreview,
    activeOverlay,
    setActiveOverlay,
    currentMethodsVisible,
    closeCurrentClassMethods,
    projectPickerVisible: projectOpening.projectPickerVisible,
    closeProjectPicker: projectOpening.closeProjectPicker,
    projectDecisionVisible: projectOpening.projectDecisionVisible,
    cancelPendingProjectOpen: projectOpening.cancelPendingProjectOpen,
    settingsVisible,
    closeSettings,
    bottomContentVisible,
    bottomToolWindowRef,
    hideBottomToolWindow,
    filesVisible,
    filesPaneRef,
    setFilesVisible,
    setBottomContentVisible,
    focusEditor,
    onStatusChange,
  });

  const { openWorkspace, openDemoWorkspace, loadProjectDirectoryForActiveWorkspace } = useWorkspaceOpeningController({
    workspace,
    workspaceApi,
    settingsHydrated,
    recentProjects,
    getWorkspaceSessions: () => settingsRef.current.state.settings.workspaceSessions,
    applyWorkspaceSessionSnapshot,
    restoreFile,
    resetProjectTree,
    loadProjectDirectory,
    loadProjectDirectoryForWorkspace,
    resetWorkspaceUi,
    loadBuildConfigurationsForRoot,
    refreshSemanticState,
    setProjectPathInput: (rootPath) => projectOpeningActionsRef.current.setProjectPathInput(rootPath),
    setProjectOpenError: (message) => projectOpeningActionsRef.current.setProjectOpenError(message),
    onStatusChange,
  });
  workspaceOpeningActionsRef.current.openWorkspace = openWorkspace;
  const gitBranchController = useGitBranchController({
    workspaceApi,
    workspaceRootPath: workspace?.rootPath ?? null,
    hasDirtyDocuments: () => documentsRef.current.hasDirtyDocuments(),
    onRefreshWorkspace: async (rootPath, branchName) => { await openWorkspace(rootPath, branchName); await sourceControl.refresh(); },
    onStatusChange,
  });
  useActiveWorkspaceSessionPersistence({ activePath, branchName: sourceControl.snapshot?.currentBranch, rootPath: workspace?.rootPath, settingsHydrated, settingsRef, workspaceApi });
  useEffect(() => () => clearSettingsSaveResetTimer(), []);
  useWorkspaceIndexWatchers({
    rootPath: workspace?.rootPath ?? null,
    workspaceApi,
    applyWorkspaceIndexRefreshResult,
    refreshWorkspaceIndexTaskStatuses,
    recordWorkspaceIndexTaskStatus,
    onStatusChange,
  });

  const derived = getAppShellDerivedState({ workspace, workspaceIndex: workspaceIndexRef.current, workspaceIndexState, workspaceIndexStatusSummary, quickOpenQuery, persistentQuickOpenAvailable: Boolean(workspaceApi.queryWorkspaceCandidatesWithReadiness || workspaceApi.queryWorkspaceQuickOpen), recentFiles: tabsRef.current.state.recentFiles, recentProjects, activeOverlay, searchEverywhereMode, searchEverywhereTruncationNotice: searchSessionStore.getSnapshot().truncationNotice, semanticState, settingsApplyState });
  const quickOpen = useQuickOpenController({ active: activeOverlay === "quickOpen", rootPath: workspace?.rootPath ?? null, query: quickOpenQuery, localResults: derived.quickOpenResults, queryLocal: (query) => workspaceIndexRef.current.queryQuickOpen(query, 8).flatMap((candidate) => candidate.path ? [{ path: candidate.path }] : []), queryWorkspace: workspaceApi.queryWorkspaceQuickOpen, queryWorkspaceWithReadiness: workspaceApi.queryWorkspaceCandidatesWithReadiness, cancelWorkspaceSearch: workspaceApi.cancelWorkspaceSearch, onError: onStatusChange });
  const commandPaletteItems = useAppShellCommands({ quickOpenQuery, activeOverlay, workspaceEditPreviewOpen: Boolean(workspaceEditPreview), codeActionsVisible, currentMethodsVisible, settingsVisible, settingsApplying, actions: { closeTransientUi, closeActiveFile, hideActiveToolWindow, toggleEditorOnly: enterEditorOnlyMode, navigateBack: () => void navigateBackFromHistory(), openQuickOpen: () => setOverlay("quickOpen"), openSearchEverywhere: () => openSearchOverlay("searchEverywhere"), openFindInFiles: () => openSearchOverlay("find"), openReplaceInFiles: () => openSearchOverlay("replace"), openRecentFiles: () => setOverlay("recentFiles"), openCommandPalette: () => setOverlay("commandPalette"), openCompletion: openEditorCompletion, showProject: () => showLeftTool("project"), showProblems: () => showBottomTool("problems"), showGit: () => showLeftTool("git"), showTerminal: () => showBottomTool("terminal"), goToDefinition: () => void goToDefinitionFromEditor(), findUsages: () => void findUsagesFromEditor(), showCurrentClassMethods, showCodeActions: () => void showCodeActionsFromEditor(), renameSymbol: () => void showCodeActionsFromEditor("rename"), generateCode: () => void showCodeActionsFromEditor("generate"), refactorThis: () => void showCodeActionsFromEditor("refactor"), save: () => void saveActiveDocument(), openProject: () => void projectOpening.openProjectPicker(), openDemoWorkspace: () => void openDemoWorkspace(), openRecentProjects: () => setOverlay("recentProjects"), newFile: () => openRootProjectMutationDialog("newFile"), newDirectory: () => openRootProjectMutationDialog("newDirectory"), openGoToLine: () => setOverlay("goToLine"), runLint: () => void runLint(), formatActiveDocument: () => void formatActiveDocument(), loadDiff: () => void loadDiff(), switchGitBranch: () => { setActiveOverlay("none"); gitBranchController.open(); }, openSettings: () => void openSettings(), toggleGitBlame, refreshGitBlame, showCurrentLineBlame, closeGitBlame } });
  return (
    <div className="app-shell" data-bottom-layout-token={bottomLayoutToken} data-open-document-count={documentsRef.current.documentCount()} data-open-tab-count={openTabs.length}>
      <AppShellMainLayout
        topBar={{ activeBottomTool, bottomToolVisible: bottomContentVisible, activeOverlay, workspaceName: workspace?.rootName ?? null, settingsOpen: settingsVisible, onOpenProject: () => void projectOpening.openProjectPicker(), onOpenRecentProjects: () => setOverlay("recentProjects"), onNewFile: () => openRootProjectMutationDialog("newFile"), onNewDirectory: () => openRootProjectMutationDialog("newDirectory"), onOpenSearchEverywhere: () => openSearchOverlay("searchEverywhere"), onOpenFindInFiles: () => openSearchOverlay("find"), onOpenReplaceInFiles: () => openSearchOverlay("replace"), onOpenCommandPalette: () => setOverlay("commandPalette"), onRunLint: () => void runLint(), onRunBuild: () => void runBuild(), onLoadDiff: () => showLeftTool("git"), onOpenTerminal: () => showBottomTool("terminal"), onOpenSettings: () => void openSettings(), onToggleEditorOnly: enterEditorOnlyMode }}
        sidebar={{ activePath, selectedProjectPath, activeTool: activeLeftTool, filesVisible, width: leftSidebarWidth, workspace, useLazyProjectTree: derived.useLazyProjectTree, projectTreeChildren, projectTreeLoadingPaths, filesPaneRef, onOpenFile: (path) => void openFile(path), onSelectProjectPath: setSelectedProjectPath, onLoadProjectDirectory: loadProjectDirectoryForActiveWorkspace, onRequestProjectMutation: (request) => openProjectMutationDialog(request.action, request.parentPath), onResizeWidth: resizeLeftSidebar, onSelectTool: showLeftTool, sourceControlProps: { snapshot: sourceControl.snapshot, selected: sourceControl.selected, commitDraft: sourceControl.commitDraft, operation: sourceControl.operation, error: sourceControl.error, loadingMoreChanges: sourceControl.loadingMoreChanges, loadingAmendMessage: sourceControl.loadingAmendMessage, history: sourceControl.history, conflict: sourceControl.conflict, discard: sourceControl.discard, stash: sourceControl.stash, dirtyGuard: sourceControl.dirtyGuard, onChangeCommitMessage: sourceControl.setCommitMessage, onChangeCommitAmend: (amend) => void sourceControl.setCommitAmend(amend), onChangeCommitSignOff: sourceControl.setCommitSignOff, onRefresh: sourceControl.refresh, onLoadMoreChanges: sourceControl.loadMoreChanges, onCommit: (action) => void sourceControl.commit(action), onFetch: sourceControl.fetchRemote, onPull: sourceControl.pullRemote, onPush: sourceControl.pushRemote, onOpenDiff: (selection) => void sourceControl.openDiff(selection), onOpenFile: (path) => void openFile(path), onStage: sourceControl.stage, onUnstage: sourceControl.unstage, onStageAll: sourceControl.stageAll, onUnstageAll: sourceControl.unstageAll } }}
        editor={{ queryPanelVisible, usageSearch, onCloseEditorQueryPanel: closeEditorQueryPanel, onOpenUsage: (item) => void openUsageResult(item), activePath, documentsRef, openTabs, appearance: editorAppearance, focusToken: editorFocusToken, completionTarget: editorCompletionTarget, completionEnabled: !settingsApplying, insertTextTarget, selectionTarget, workspaceName: workspace?.rootName ?? null, surfaceRef: editorSurfaceRef, onChange: handleEditorChange, onDocumentChange: handleEditorDocumentChange, onSelectionChange: handleEditorSelectionChange, onDefinitionTrigger: (selection) => void goToDefinitionFromEditor(selection, "modifierClick"), onCodeMirrorCompletionRequest: workspace ? completionBroker : undefined, onCodeMirrorCompletionResolve: workspace ? completionResolver : undefined, onCodeMirrorSignatureHelpRequest: workspace ? signatureHelpBroker : undefined, blameAttributions: gitTraceState.blameAttributions, gitBlameVisible, selectedBlameLine: selectedBlameAttribution?.bufferLine ?? gitTraceState.selectedLine, onGitTraceLineClick: selectGitBlameLine, onSelectTab: setActiveDocument, onCloseTab: closeEditorTab, onCloseOtherTabs: closeOtherEditorTabs, onCloseTabsToRight: closeEditorTabsToRight, onCopyTabPath: copyEditorTabPath, onEditorGoToDefinition: (selection) => void goToDefinitionFromEditor(selection, "keyboard"), onEditorFindUsages: () => void findUsagesFromEditor(), onEditorFormatDocument: () => void formatActiveDocument(), onEditorCopyPath: copyActiveEditorPath, onToggleGitBlame: toggleGitBlame }}
      />
      <AppShellOverlays
        selectedBlameAttribution={selectedBlameAttribution}
        onCloseBlameCard={() => setSelectedBlameAttribution(null)}
        onShowSelectedBlameCommit={showSelectedBlameCommit}
        onShowSelectedBlameDiff={showSelectedBlameDiff}
        onShowSelectedLocalDiff={() => void showSelectedLocalDiff()}
        onCopySelectedBlameHash={copySelectedBlameHash}
        overlayVisible={derived.overlayVisible}
        activeOverlay={activeOverlay}
        overlayLabel={derived.overlayLabel}
        onCloseOverlay={() => setActiveOverlay("none")}
        commandPaletteItems={commandPaletteItems}
        searchOverlayProps={{ quickOpenQuery, quickOpenResults: quickOpen.results, quickOpenSelectedIndex: quickOpen.selectedIndex, recentFileResults: derived.recentFileResults, recentProjectResults: derived.recentProjectResults, searchEverywhereOptions, searchEverywhereMode, searchEverywhereScope, searchEverywhereReplaceQuery, searchSessionStore, workspacePartialNotice: derived.workspacePartialNotice, onChangeQuery: handleOverlayQueryChange, onDraftQueryChange: handleOverlayQueryDraftChange, onChangeSearchEverywhereScope: setSearchEverywhereScope, onChangeSearchEverywhereReplaceQuery: setSearchEverywhereReplaceQuery, onOpenFile: (path) => void openFile(path), onMoveQuickOpenSelection: quickOpen.moveSelection, onSelectQuickOpenResult: quickOpen.setSelectedIndex, onOpenSearchEverywhereResult: (result) => void openSearchEverywhereResult(result.path, result.line, result.column), onOpenSearchEverywhereCandidate: (candidate) => void openSearchEverywhereCandidate(candidate), onLoadNextSearchEverywherePage: () => void loadNextSearchEverywherePage?.(), onOpenProject: (path) => void projectOpening.requestProjectOpen(path), onMoveSearchEverywhereSelection: moveSearchEverywhereSelection, onOpenSelectedSearchEverywhereResult: () => void openSelectedSearchEverywhereResult(), onSelectSearchEverywhereResult: setSearchEverywhereSelectedIndex, onToggleSearchEverywhereCaseSensitive: toggleSearchEverywhereCaseSensitive, onToggleSearchEverywhereWholeWord: toggleSearchEverywhereWholeWord, onSubmitGoToLine: submitGoToLine }}
        gitBranchPickerProps={{ open: gitBranchController.visible, currentBranch: gitBranchController.currentBranch, query: gitBranchController.query, items: gitBranchController.items, selectedIndex: gitBranchController.selectedIndex, loading: gitBranchController.loading, switching: gitBranchController.switching, error: gitBranchController.error, pendingCheckout: gitBranchController.pendingCheckout, workingTreeChangedFiles: gitBranchController.snapshot?.workingTree.changedFiles ?? 0, workingTreeConflictedFiles: gitBranchController.snapshot?.workingTree.conflictedFiles ?? 0, onChangeQuery: gitBranchController.setQuery, onSelectIndex: gitBranchController.setSelectedIndex, onMoveSelection: gitBranchController.moveSelection, onCheckout: gitBranchController.checkout, onCheckoutSelected: gitBranchController.checkoutSelected, onCancelPendingCheckout: gitBranchController.cancelPendingCheckout, onPreserveAndCheckout: gitBranchController.preserveAndCheckout, onStashAndCheckout: gitBranchController.stashAndCheckout, onClose: gitBranchController.close }}
        projectMutationDialog={projectMutationDialog}
        onChangeProjectMutationName={(name) => setProjectMutationDialog((current) => current ? { ...current, name } : current)}
        onCloseProjectMutationDialog={() => setProjectMutationDialog(null)}
        onSubmitProjectMutationDialog={() => void submitProjectMutationDialog()}
        currentMethodsVisible={currentMethodsVisible}
        currentMethodsProps={{ query: currentMethodsQuery, methods: visibleCurrentClassMethods, selectedIndex: currentMethodsSelectedIndex, onChangeQuery: setCurrentMethodsQuery, onClose: closeCurrentClassMethods, onOpenMethod: openCurrentClassMethod, onSelectIndex: setCurrentMethodsSelectedIndex }}
        codeActionsVisible={codeActionsVisible}
        codeActionsProps={{ actions: codeActions, status: codeActionsStatus, message: codeActionsMessage, selectedIndex: codeActionsSelectedIndex, onClose: closeCodeActionsPalette, onResolveAction: (action) => void resolveCodeActionFromPalette(action), onSelectIndex: setCodeActionsSelectedIndex }}
        workspaceEditPreview={workspaceEditPreview}
        workspaceEditProps={{ applyState: workspaceEditApplyState, message: workspaceEditMessage, onApply: () => void applyWorkspaceEditPreview(), onClose: closeWorkspaceEditPreview }}
        openProjectDialogProps={{ open: projectOpening.projectPickerVisible, errorMessage: projectOpening.projectOpenError, projectPath: projectOpening.projectPathInput, onChangeProjectPath: projectOpening.setProjectPathInput, onClose: projectOpening.closeProjectPicker, onOpenProject: () => void projectOpening.confirmOpenProject() }}
        openProjectDecisionDialogProps={{ open: projectOpening.projectDecisionVisible, projectName: getPathBasename(projectOpening.pendingProjectPath ?? "") || "Project", onChooseThisWindow: () => void projectOpening.openPendingProjectInThisWindow(), onChooseNewWindow: () => void projectOpening.openPendingProjectInNewWindow(), onCancel: projectOpening.cancelPendingProjectOpen }}
        settingsDialogProps={{ environmentReport, open: settingsVisible, saveStateLabel: settingsSaveState === "saving" ? "Saving..." : settingsSaveState === "saved" ? "Saved" : "Ready", settings: settingsRef.current.state.settings, onClose: closeSettings, onApply: applySettings, onPickPath: pickSettingsPath, onRefreshEnvironment: () => void refreshEnvironmentReport() }}
      />
      <AppShellToolWindows
        bottomToolWindowRef={bottomToolWindowRef} activeBottomTool={activeBottomTool} bottomContentVisible={bottomContentVisible} bottomToolHeight={bottomToolHeight} bottomLayoutToken={bottomLayoutToken} maxBottomToolHeight={maxBottomToolHeight} resizeBottomToolWindow={resizeBottomToolWindow} toggleBottomToolMaxHeight={toggleBottomToolMaxHeight} showBottomTool={showBottomTool} toggleBottomTool={toggleBottomTool} hideBottomToolWindow={hideBottomToolWindow}
        problems={problems} workspaceApi={workspaceApi} workspaceRootPath={workspace?.rootPath ?? null} terminalSettings={terminalSettings}
        buildState={buildState} buildModules={buildProject?.modules ?? []} onChangeBuildTarget={(lastTarget) => updateBuildState({ lastTarget })} onChangeBuildModuleName={(moduleName) => updateBuildState({ moduleName })} onChangeBuildProduct={(product) => updateBuildState({ product })} onChangeBuildMode={(buildMode) => updateBuildState({ buildMode })} onChangeBuildFastMode={(fastMode) => updateBuildState({ fastMode })} onSelectBuildConfiguration={selectBuildConfiguration} onSaveBuildConfiguration={() => void saveBuildConfiguration()} onCopyBuildConfiguration={() => void copyBuildConfiguration()} onDeleteBuildConfiguration={() => void deleteBuildConfiguration()} onRunBuild={() => void runBuild()} onRunCleanBuild={() => void runBuild(true)} onStopBuild={() => void stopBuild()}
        diffFiles={diffFiles} diffActionContext={diffActionContext} diffComparison={diffComparison} gitToolView={gitToolView} gitTraceState={gitTraceState} onChangeGitToolView={setGitToolView} onOpenGitFile={(path) => void openFile(path)} onFocusEditorFromGitTrace={focusEditorSoon} onOpenGitTraceCommitDiff={openGitTraceCommitDiff} onApplyGitPartial={sourceControl.applyPartialPatch} onStatusChange={onStatusChange}
        indexAndStatus={{ activeBottomTool, activePath, definitionDebugText, latestExplainResult, latestExplainQuery: latestExplainContext?.query ?? "", onOpenIndexExplainPanel: () => setIndexExplainPanelVisible(true), indexExplainPanelVisible, onCloseIndexExplainPanel: () => setIndexExplainPanelVisible(false), onRebuildIndexFromExplainPanel: () => void rebuildIndexFromExplainPanel(), onOpenSettingsFromExplainPanel: () => void openSettingsFromExplainPanel(), onRetryLatestExplainQuery: retryLatestExplainQuery, indexDiagnosticsVisible, indexDiagnosticsSectionTarget, indexDiagnosticsLoading, currentFileDirty: activeDocumentProjection.isDirty, indexDiagnostics, currentFileReadiness, layerReadiness, recentQueryExplains, uiLatencySamples, renderPressureSamples, ipcLatencySamples, workspaceIndexTaskStatuses, onCloseIndexDiagnostics: () => setIndexDiagnosticsVisible(false), onRefreshIndexDiagnostics: () => void Promise.all([refreshIndexDiagnostics(), refreshSemanticState()]), onResumeIndexingFromDiagnostics: () => void resumeIndexingFromDiagnostics(), onRebuildProjectIndexFromDiagnostics: () => void rebuildProjectIndexFromDiagnostics(), onRebuildSdkIndexFromDiagnostics: () => void rebuildSdkIndexFromDiagnostics(), onIndexCurrentFileFromDiagnostics: () => void indexCurrentFileFromDiagnostics(), onConfigureSdkFromDiagnostics: () => void openSettings(), semanticState, semanticCapability: derived.semanticCapability, statusMessageStore, workspaceName: workspace?.rootName ?? null, gitBranchName: sourceControl.branchLabel, gitChangeCount: sourceControl.changeCount, gitAhead: sourceControl.snapshot?.ahead ?? 0, gitBehind: sourceControl.snapshot?.behind ?? 0, workspaceScanText: derived.workspaceScanText, workspaceIndexText: derived.workspaceIndexText, sdkIndexText: derived.sdkIndexText, buildMessage: buildState.message, currentLineBlame, gitBlameVisible, gitBlameMenuOpen, onToggleGitBlameMenu: toggleGitBlameMenu, onToggleGitBlame: toggleGitBlame, onRefreshGitBlame: refreshGitBlame, onShowCurrentLineBlame: showCurrentLineBlame, onCloseGitBlame: closeGitBlame, onOpenIndexDiagnostics: openIndexDiagnostics, onOpenGitBranchPicker: () => { setActiveOverlay("none"); gitBranchController.open(); } }}
      />
    </div>
  );
}
