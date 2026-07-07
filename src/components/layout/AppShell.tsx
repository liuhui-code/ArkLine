import { useEffect, useRef, useState } from "react";
import { getAppShellDerivedState } from "@/components/layout/app-shell-derived-state";
import { AppShellOverlays } from "@/components/layout/AppShellOverlays";
import { AppShellMainLayout } from "@/components/layout/AppShellMainLayout";
import { AppShellToolWindows } from "@/components/layout/AppShellToolWindows";
import { useAppShellCommands } from "@/components/layout/use-app-shell-commands";
import { useActiveDocumentActions } from "@/components/layout/use-active-document-actions";
import { useActiveDocumentProjection } from "@/components/layout/use-active-document-projection";
import { useBuildControllerState } from "@/components/layout/use-build-controller-state";
import { useCodeActionsWorkspaceEditController } from "@/components/layout/use-code-actions-workspace-edit-controller";
import { useProjectOpening } from "@/components/layout/use-project-opening";
import { useGitAndDiffController } from "@/components/layout/use-git-and-diff-controller";
import { useEditorDocuments } from "@/components/layout/use-editor-documents";
import { useEditorNavigation } from "@/components/layout/use-editor-navigation";
import { useEditorSurfaceController } from "@/components/layout/use-editor-surface-controller";
import { useEditorTabActions } from "@/components/layout/use-editor-tab-actions";
import { useCompletionController } from "@/components/layout/use-completion-controller";
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
import { useWorkspaceOpeningController } from "@/components/layout/use-workspace-opening-controller";
import { useSemanticState } from "@/features/semantic/use-semantic-state";
import { createSettingsStore, type AppSettings } from "@/features/settings/settings-store";
import { useDefinitionController } from "@/components/layout/use-definition-controller";
import { idleUsageSearchState } from "@/features/workspace/usage-search";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";
import { useWorkspaceQueryExplains } from "@/features/workspace/use-workspace-query-explains";
import { createWorkspaceIndexStore, type WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { getPathBasename } from "@/features/workspace/workspace-store";
import { recordRenderPressure, useUiLatencyMonitor } from "@/features/performance/use-ui-latency-monitor";

type AppShellProps = { workspaceApi?: WorkspaceApi };

export function AppShell({ workspaceApi = defaultWorkspaceApi }: AppShellProps) {
  const canUseNativeProjectPicker = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [statusText, setStatusText] = useState("Mode: shell bootstrap");
  const [editorFocusToken, setEditorFocusToken] = useState(0);
  const [selectionTarget, setSelectionTarget] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [insertTextTarget, setInsertTextTarget] = useState<{ text: string; replaceBefore?: number; nonce: number } | null>(null);
  const [editorSelection, setEditorSelection] = useState({ line: 1, column: 1 });
  const [editorSelectedText, setEditorSelectedText] = useState("");
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const { recentQueryExplains, recordRecentQueryExplain } = useWorkspaceQueryExplains();
  const { recordUiInteraction, uiLatencySamples, renderPressureSamples, ipcLatencySamples } = useUiLatencyMonitor();
  recordRenderPressure("AppShell");
  const [definitionHoverActive, setDefinitionHoverActive] = useState(false);
  const settingsRef = useRef(createSettingsStore());
  const workspaceIndexRef = useRef(createWorkspaceIndexStore());
  const [workspaceIndexState, setWorkspaceIndexState] = useState<WorkspaceIndexState>(() => ({ ...workspaceIndexRef.current.state }));
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const completionActionsRef = useRef<{ clearCompletionSession: () => void; clearTypingCompletionTimer: () => void }>({
    clearCompletionSession: () => undefined,
    clearTypingCompletionTimer: () => undefined,
  });
  const searchActionsRef = useRef<{ resetSearchOverlayState: () => void }>({ resetSearchOverlayState: () => undefined });
  const settingsActionsRef = useRef<{ indexSdkSymbolsForSettings: (settings: AppSettings) => Promise<void> }>({
    indexSdkSymbolsForSettings: async () => undefined,
  });
  const gitActionsRef = useRef<{ refreshGitBlame: () => void }>({ refreshGitBlame: () => undefined });
  const editorActionsRef = useRef<{ openFile: (path: string) => Promise<void> }>({
    openFile: async () => undefined,
  });
  const workspaceOpeningActionsRef = useRef<{ openWorkspace: (rootPath: string) => Promise<void> }>({
    openWorkspace: async () => undefined,
  });
  const projectOpeningActionsRef = useRef<{
    setProjectPathInput: (rootPath: string) => void;
    setProjectOpenError: (message: string | null) => void;
  }>({
    setProjectPathInput: () => undefined,
    setProjectOpenError: () => undefined,
  });
  const { documentsRef, tabsRef, openTabs, activePath, editorContent, setEditorContent, syncTabs, syncEditor, setActiveDocument, resetTabs } = useEditorDocuments();
  const activeDocumentProjection = useActiveDocumentProjection({ documentsRef, activePath, line: editorSelection.line, column: editorSelection.column, selectedText: editorSelectedText });
  const { focusEditor, focusEditorSoon, isEditorFocused, rememberCurrentLocation, navigateToLocation, navigateBackFromHistory } = useEditorNavigation({
    activePath,
    editorSelection,
    editorSurfaceRef,
    openFile: (path) => editorActionsRef.current.openFile(path),
    setSelectionTarget,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    onStatusChange: setStatusText,
  });
  const { closeActiveFile, closeEditorTab, closeOtherEditorTabs, closeEditorTabsToRight, copyEditorTabPath, copyActiveEditorPath } = useEditorTabActions({
    tabsRef,
    activePath,
    syncTabs,
    setActiveDocument,
    resetTransientEditorTargets: () => {
      completionActionsRef.current.clearCompletionSession();
      setInsertTextTarget(null);
      setSelectionTarget(null);
    },
    onStatusChange: setStatusText,
    onFocusEditorSoon: focusEditorSoon,
  });
  const { filesVisible, setFilesVisible, leftSidebarWidth, bottomContentVisible, setBottomContentVisible, bottomToolHeight, bottomLayoutToken, activeLeftTool, activeBottomTool, activeOverlay, setActiveOverlay, quickOpenQuery, setQuickOpenQuery, filesPaneRef, bottomToolWindowRef, maxBottomToolHeight, resizeBottomToolWindow, resizeLeftSidebar, toggleBottomToolMaxHeight, showLeftTool, showBottomTool, toggleBottomTool, hideBottomToolWindow, setOverlay } = useShellLayoutState({
    onBeforeNonCompletionOverlay: () => completionActionsRef.current.clearCompletionSession(),
    onResetOverlaySearch: () => searchActionsRef.current.resetSearchOverlayState(),
    onStatusChange: setStatusText,
    onFocusEditorSoon: focusEditorSoon,
  });
  const { problems, resetProblems, refreshProblems, runLint, replaceBuildProblems } = useProblemsController({
    workspaceApi,
    activePath,
    editorContent,
    showProblems: () => showBottomTool("problems"),
    onStatusChange: setStatusText,
  });
  const { formatActiveDocument, saveActiveDocument } = useActiveDocumentActions({
    activePath,
    editorContent,
    documentsRef,
    syncTabs,
    setEditorContent,
    saveFile: workspaceApi.saveFile,
    getFormatOnSave: () => settingsRef.current.state.settings.validation.formatOnSave,
    refreshProblems,
    showProblems: () => showBottomTool("problems"),
    refreshBlame: () => gitActionsRef.current.refreshGitBlame(),
    onStatusChange: setStatusText,
  });
  const { projectTreeChildren, projectTreeLoadingPaths, selectedProjectPath, setSelectedProjectPath, resetProjectTree, loadProjectDirectory, loadProjectDirectoryForWorkspace } = useProjectTreeActions({
    workspaceApi,
    onStatusChange: setStatusText,
  });
  const { workspace, setWorkspace, recentProjects, setRecentProjects, syncWorkspaceIndex, applyWorkspaceIndexRefreshResult, applyWorkspaceSnapshot: applyWorkspaceSessionSnapshot, includeVisibleWorkspaceFile } = useWorkspaceSession({
    workspaceApi,
    onOpenWorkspaceIndex: (nextWorkspace) => {
      workspaceIndexRef.current.openWorkspace(nextWorkspace);
      setWorkspaceIndexState({ ...workspaceIndexRef.current.state });
    },
    onReplaceWorkspaceIndexState: (state) => {
      workspaceIndexRef.current.replaceState(state);
      setWorkspaceIndexState({ ...workspaceIndexRef.current.state });
    },
    onPersistRecentProjects: (next) => {
      settingsRef.current.update({ recentProjects: next });
      void workspaceApi.saveSettings(settingsRef.current.state.settings);
    },
    onStatusChange: setStatusText,
  });
  const { semanticState, refreshSemanticState } = useSemanticState(workspaceApi);
  const { buildState, buildProject, loadBuildConfigurationsForRoot, updateBuildState, saveBuildConfiguration, copyBuildConfiguration, deleteBuildConfiguration, selectBuildConfiguration, runBuild, stopBuild } = useBuildControllerState({
    workspace,
    workspaceApi,
    activePath,
    selectedProjectPath,
    sdkSettings: settingsRef.current.state.settings.sdk,
    showBuild: () => showBottomTool("build"),
    replaceBuildProblems,
    onStatusChange: setStatusText,
  });
  const { settingsVisible, settingsSaveState, settingsApplyState, settingsApplying, environmentReport, editorAppearance, clearSettingsSaveResetTimer, refreshEnvironmentReport, openSettings, closeSettings, pickSettingsPath, applySettings } = useSettingsController({
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
    onBeforeApply: () => completionActionsRef.current.clearTypingCompletionTimer(),
    onStatusChange: setStatusText,
  });
  const { latestExplainResult, latestExplainContext, indexExplainPanelVisible, setIndexExplainPanelVisible, indexDiagnosticsVisible, setIndexDiagnosticsVisible, indexDiagnosticsLoading, indexDiagnostics, currentFileReadiness, layerReadiness, workspaceIndexTaskStatuses, recordWorkspaceIndexTaskStatus, refreshWorkspaceIndexTaskStatuses, refreshIndexDiagnostics, openIndexDiagnostics, resumeIndexingFromDiagnostics, rebuildSdkIndexFromDiagnostics, indexSdkSymbolsForSettings, explainIndexMiss, rebuildIndexFromExplainPanel, openSettingsFromExplainPanel, retryLatestExplainQuery } = useIndexDiagnosticsController({
    workspaceApi,
    workspace,
    activePath,
    applyWorkspaceIndexRefreshResult,
    openSettings,
    retryDefinitionQuery: (selection) => void goToDefinitionFromEditor(selection, "keyboard"),
    retrySearchQuery: (query) => {
      setQuickOpenQuery(query);
      openSearchOverlay("searchEverywhere");
    },
    onStatusChange: setStatusText,
  });
  settingsActionsRef.current.indexSdkSymbolsForSettings = indexSdkSymbolsForSettings;
  const { searchEverywhereMode, searchEverywhereScope, setSearchEverywhereScope, searchEverywhereReplaceQuery, setSearchEverywhereReplaceQuery, searchEverywhereOptions, searchSessionStore, setSearchEverywhereSelectedIndex, openSearchOverlay, handleOverlayQueryChange, resetSearchOverlayState, moveSearchEverywhereSelection, openSearchEverywhereResult, openSearchEverywhereCandidate, openSelectedSearchEverywhereResult, toggleSearchEverywhereCaseSensitive, toggleSearchEverywhereWholeWord } = useSearchEverywhereController({
    workspaceApi,
    workspace,
    activePath,
    editorContent,
    editorSelectedText,
    quickOpenQuery,
    activeOverlay,
    indexVersionKey: `${workspaceIndexState.indexedAt ?? ""}:${workspaceIndexState.status}`,
    setQuickOpenQuery,
    setActiveOverlay,
    queryIndexCandidates: (query, scope, limit) => workspaceIndexRef.current.queryCandidates(query, scope, limit),
    getTextSearchPaths: () => workspaceIndexRef.current.getTextSearchPaths(),
    getRecentPaths: () => tabsRef.current.state.recentFiles,
    replaceQueryReadiness: (readiness) => {
      workspaceIndexRef.current.replaceQueryReadiness(readiness);
      setWorkspaceIndexState({ ...workspaceIndexRef.current.state });
    },
    getOpenDocumentContent: (path) => documentsRef.current.getDocument(path)?.currentContent ?? null,
    hasDirtyDocuments: () => documentsRef.current.getDocuments().some((document) => document.isDirty),
    rememberCurrentLocation,
    navigateToLocation,
    explainIndexMiss,
    recordRecentQueryExplain,
    recordUiInteraction,
    onStatusChange: setStatusText,
  });
  searchActionsRef.current.resetSearchOverlayState = resetSearchOverlayState;
  const { completionAnchor, setCompletionAnchor, completionSelectedIndex, setCompletionSelectedIndex, completionStatus, completionMessage, completionPresentationResults, selectedCompletionPresentation, completionPopupVisible, completionPopupPosition, clearTypingCompletionTimer, clearCompletionSession, resetCompletion, openCompletionFromEditor, triggerTypingCompletion, insertCompletionItem, syncCompletionForEditorSelection } = useCompletionController({
    workspaceApi,
    rootPath: workspace?.rootPath,
    activePath,
    editorContent,
    editorSelection,
    quickOpenQuery,
    activeOverlay,
    settingsApplying,
    getActiveContent: () => activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent : editorContent,
    setActiveOverlay,
    setQuickOpenQuery,
    setInsertTextTarget,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    focusEditorSoon,
    isEditorFocused,
    recordRecentQueryExplain,
    onStatusChange: setStatusText,
  });
  completionActionsRef.current.clearCompletionSession = clearCompletionSession;
  completionActionsRef.current.clearTypingCompletionTimer = clearTypingCompletionTimer;
  const { currentMethodsVisible, currentMethodsQuery, setCurrentMethodsQuery, currentMethodsSelectedIndex, setCurrentMethodsSelectedIndex, visibleCurrentClassMethods, showCurrentClassMethods, hideCurrentClassMethods, closeCurrentClassMethods, openCurrentClassMethod } = useCurrentFileSymbolsController({
    workspaceApi,
    rootPath: workspace?.rootPath,
    activePath,
    editorContent,
    editorLine: editorSelection.line,
    getActiveContent: () => activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent : editorContent,
    onBeforeShow: () => setActiveOverlay("none"),
    rememberCurrentLocation,
    setSelectionTarget,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    focusEditorSoon,
    onStatusChange: setStatusText,
  });
  const { codeActionsVisible, codeActions, codeActionsStatus, codeActionsMessage, codeActionsSelectedIndex, setCodeActionsSelectedIndex, workspaceEditPreview, workspaceEditApplyState, workspaceEditMessage, projectMutationDialog, setProjectMutationDialog, resetCodeActions, resetWorkspaceEdit, resetCodeActionSession, closeCodeActionsPalette, closeWorkspaceEditPreview, applyWorkspaceEditPreview, openProjectMutationDialog, openRootProjectMutationDialog, submitProjectMutationDialog, showCodeActionsFromEditor, resolveCodeActionFromPalette } = useCodeActionsWorkspaceEditController({
    workspace,
    workspaceApi,
    activePath,
    editorContent,
    editorSelection,
    settingsApplying,
    documentsRef,
    tabsRef,
    setWorkspace,
    syncTabs,
    syncWorkspaceIndex,
    setActiveDocument,
    setEditorContent,
    clearCompletionSession,
    resetCompletionAnchor: () => setCompletionAnchor(null),
    closeOverlay: () => setActiveOverlay("none"),
    hideCurrentClassMethods,
    focusEditorSoon,
    onStatusChange: setStatusText,
  });
  const { openFile, submitGoToLine, handleEditorChange, handleEditorSelectionChange } = useEditorSurfaceController({
    workspaceApi,
    activePath,
    quickOpenQuery,
    documentsRef,
    tabsRef,
    syncTabs,
    setActiveDocument,
    includeVisibleWorkspaceFile,
    clearCompletionSession,
    resetCompletionAnchor: () => setCompletionAnchor(null),
    resetCodeActionSession,
    setEditorSelection,
    setEditorSelectedText,
    setInsertTextTarget,
    setSelectionTarget,
    setActiveOverlay,
    setQuickOpenQuery,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    rememberCurrentLocation,
    focusEditorSoon,
    syncCompletionForEditorSelection,
    onStatusChange: setStatusText,
  });
  editorActionsRef.current.openFile = openFile;
  const { usageSearch, setUsageSearch, queryPanelVisible, openEditorQueryPanel, closeEditorQueryPanel, findUsagesFromEditor, openUsageResult } = useUsagesController({
    workspaceApi,
    workspace,
    activePath,
    editorSelection,
    getActiveContent: () => activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent : editorContent,
    settingsApplying,
    rememberCurrentLocation,
    navigateToUsage: (item) => navigateToLocation({ path: item.path, line: item.line, column: item.column }, "Usage"),
    recordRecentQueryExplain,
    onStatusChange: setStatusText,
  });
  const { definitionDebugText, goToDefinitionFromEditor } = useDefinitionController({
    workspaceApi,
    workspace,
    activePath,
    editorSelection,
    getActiveContent: () => activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent : editorContent,
    settingsApplying,
    openEditorQueryPanel,
    setUsageSearch,
    rememberCurrentLocation,
    openFile,
    setSelectionTarget,
    bumpEditorFocusToken: () => setEditorFocusToken((token) => token + 1),
    focusEditorSoon,
    explainIndexMiss,
    recordRecentQueryExplain,
    onStatusChange: setStatusText,
  });
  const activeDocument = activePath ? documentsRef.current.getDocument(activePath) : undefined;
  const { diffFiles, gitToolView, setGitToolView, gitTraceState, currentLineBlame, gitBlameVisible, gitBlameMenuOpen, selectedBlameAttribution, setSelectedBlameAttribution, toggleGitBlame, toggleGitBlameMenu, refreshGitBlame, closeGitBlame, showCurrentLineBlame, selectGitBlameLine, showSelectedBlameDiff, showSelectedBlameCommit, showSelectedLocalDiff, copySelectedBlameHash, loadDiff, openGitTraceCommitDiff, closeTransientGitUi, resetDiff } = useGitAndDiffController({
    workspaceRootPath: workspace?.rootPath ?? null,
    workspaceApi,
    activePath,
    activeLine: editorSelection.line,
    activeText: activeDocument?.currentContent ?? editorContent,
    baseText: activeDocument?.originalContent ?? editorContent,
    gitToolVisible: bottomContentVisible && activeBottomTool === "git",
    showGit: () => showBottomTool("git"),
    setEditorSelection,
    focusEditor,
    onStatusChange: setStatusText,
  });
  gitActionsRef.current.refreshGitBlame = refreshGitBlame;
  const projectOpening = useProjectOpening({ canUseNativeProjectPicker, hasWorkspace: workspace !== null, workspaceApi, workspaceRootPath: workspace?.rootPath ?? null, openWorkspace: (rootPath) => workspaceOpeningActionsRef.current.openWorkspace(rootPath), focusEditorSoon, onBeforeProjectOpen: () => setActiveOverlay("none"), onStatusChange: setStatusText });
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
    resetCompletion,
    resetUsageSearch: () => setUsageSearch(idleUsageSearchState()),
    resetEditorState: () => {
      setEditorSelection({ line: 1, column: 1 });
      setInsertTextTarget(null);
      setSelectionTarget(null);
    },
    showBottomContent: () => setBottomContentVisible(true),
    onStatusChange: setStatusText,
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
    onStatusChange: setStatusText,
  });

  const { openWorkspace, openDemoWorkspace, loadProjectDirectoryForActiveWorkspace } = useWorkspaceOpeningController({
    workspace,
    workspaceApi,
    settingsHydrated,
    recentProjects,
    getWorkspaceSessions: () => settingsRef.current.state.settings.workspaceSessions,
    applyWorkspaceSessionSnapshot,
    openFile,
    resetProjectTree,
    loadProjectDirectory,
    loadProjectDirectoryForWorkspace,
    resetWorkspaceUi,
    loadBuildConfigurationsForRoot,
    refreshSemanticState,
    setProjectPathInput: (rootPath) => projectOpeningActionsRef.current.setProjectPathInput(rootPath),
    setProjectOpenError: (message) => projectOpeningActionsRef.current.setProjectOpenError(message),
    onStatusChange: setStatusText,
  });
  workspaceOpeningActionsRef.current.openWorkspace = openWorkspace;

  useEffect(() => {
    if (!settingsHydrated || !workspace?.rootPath || !activePath) return;
    const current = settingsRef.current.state.settings;
    const currentSession = current.workspaceSessions[workspace.rootPath] ?? {};
    if (currentSession.activeFilePath === activePath) return;
    const nextWorkspaceSessions = {
      ...current.workspaceSessions,
      [workspace.rootPath]: { ...currentSession, activeFilePath: activePath },
    };
    settingsRef.current.update({ workspaceSessions: nextWorkspaceSessions });
    void workspaceApi.saveSettings(settingsRef.current.state.settings);
  }, [activePath, settingsHydrated, workspace?.rootPath, workspaceApi]);

  useEffect(() => () => {
    clearTypingCompletionTimer();
    clearSettingsSaveResetTimer();
  }, []);
  useWorkspaceIndexWatchers({
    rootPath: workspace?.rootPath ?? null,
    workspaceApi,
    applyWorkspaceIndexRefreshResult,
    refreshWorkspaceIndexTaskStatuses,
    recordWorkspaceIndexTaskStatus,
    onStatusChange: setStatusText,
  });

  const derived = getAppShellDerivedState({ workspace, workspaceIndex: workspaceIndexRef.current, workspaceIndexState, workspaceIndexTaskStatuses, layerReadiness, quickOpenQuery, recentFiles: tabsRef.current.state.recentFiles, recentProjects, activeOverlay, searchEverywhereMode, searchEverywhereTruncationNotice: searchSessionStore.getSnapshot().truncationNotice, semanticState, settingsApplyState });

  const commandPaletteItems = useAppShellCommands({ quickOpenQuery, activeOverlay, workspaceEditPreviewOpen: Boolean(workspaceEditPreview), codeActionsVisible, currentMethodsVisible, settingsVisible, settingsApplying, actions: { closeTransientUi, closeActiveFile, hideActiveToolWindow, toggleEditorOnly: enterEditorOnlyMode, navigateBack: () => void navigateBackFromHistory(), openQuickOpen: () => setOverlay("quickOpen"), openSearchEverywhere: () => openSearchOverlay("searchEverywhere"), openFindInFiles: () => openSearchOverlay("find"), openReplaceInFiles: () => openSearchOverlay("replace"), openRecentFiles: () => setOverlay("recentFiles"), openCommandPalette: () => setOverlay("commandPalette"), openCompletion: () => void openCompletionFromEditor(), showProject: () => showLeftTool("project"), showProblems: () => showBottomTool("problems"), showGit: () => showBottomTool("git"), showTerminal: () => showBottomTool("terminal"), goToDefinition: () => void goToDefinitionFromEditor(), findUsages: () => void findUsagesFromEditor(), showCurrentClassMethods, showCodeActions: () => void showCodeActionsFromEditor(), renameSymbol: () => void showCodeActionsFromEditor("rename"), generateCode: () => void showCodeActionsFromEditor("generate"), refactorThis: () => void showCodeActionsFromEditor("refactor"), save: () => void saveActiveDocument(), openProject: () => void projectOpening.openProjectPicker(), openDemoWorkspace: () => void openDemoWorkspace(), openRecentProjects: () => setOverlay("recentProjects"), newFile: () => openRootProjectMutationDialog("newFile"), newDirectory: () => openRootProjectMutationDialog("newDirectory"), openGoToLine: () => setOverlay("goToLine"), runLint: () => void runLint(), formatActiveDocument: () => void formatActiveDocument(), loadDiff: () => void loadDiff(), openSettings: () => void openSettings(), toggleGitBlame, refreshGitBlame, showCurrentLineBlame, closeGitBlame } });
  return (
    <div className="app-shell" data-bottom-layout-token={bottomLayoutToken}>
      <AppShellMainLayout
        topBar={{ activeBottomTool, bottomToolVisible: bottomContentVisible, activeOverlay, workspaceName: workspace?.rootName ?? null, settingsOpen: settingsVisible, onOpenProject: () => void projectOpening.openProjectPicker(), onOpenRecentProjects: () => setOverlay("recentProjects"), onNewFile: () => openRootProjectMutationDialog("newFile"), onNewDirectory: () => openRootProjectMutationDialog("newDirectory"), onOpenSearchEverywhere: () => openSearchOverlay("searchEverywhere"), onOpenFindInFiles: () => openSearchOverlay("find"), onOpenReplaceInFiles: () => openSearchOverlay("replace"), onOpenCommandPalette: () => setOverlay("commandPalette"), onRunLint: () => void runLint(), onRunBuild: () => void runBuild(), onLoadDiff: () => void loadDiff(), onOpenTerminal: () => showBottomTool("terminal"), onOpenSettings: () => void openSettings(), onToggleEditorOnly: enterEditorOnlyMode }}
        sidebar={{ activePath, selectedProjectPath, activeTool: activeLeftTool, filesVisible, width: leftSidebarWidth, workspace, useLazyProjectTree: derived.useLazyProjectTree, projectTreeChildren, projectTreeLoadingPaths, filesPaneRef, onOpenFile: (path) => void openFile(path), onSelectProjectPath: setSelectedProjectPath, onLoadProjectDirectory: loadProjectDirectoryForActiveWorkspace, onRequestProjectMutation: (request) => openProjectMutationDialog(request.action, request.parentPath), onResizeWidth: resizeLeftSidebar, onSelectTool: showLeftTool }}
        editor={{ queryPanelVisible, usageSearch, onCloseEditorQueryPanel: closeEditorQueryPanel, onOpenUsage: (item) => void openUsageResult(item), activePath, documentsRef, openTabs, appearance: editorAppearance, focusToken: editorFocusToken, insertTextTarget, selectionTarget, workspaceName: workspace?.rootName ?? null, surfaceRef: editorSurfaceRef, onChange: handleEditorChange, onSelectionChange: handleEditorSelectionChange, onCaretRectChange: setCompletionAnchor, onDefinitionTrigger: (selection) => void goToDefinitionFromEditor(selection, "modifierClick"), onDefinitionHoverChange: (state) => setDefinitionHoverActive(state.active), onTypingCompletionTrigger: triggerTypingCompletion, blameAttributions: gitTraceState.blameAttributions, gitBlameVisible, selectedBlameLine: selectedBlameAttribution?.bufferLine ?? gitTraceState.selectedLine, onGitTraceLineClick: selectGitBlameLine, definitionHoverActive, onSelectTab: setActiveDocument, onCloseTab: closeEditorTab, onCloseOtherTabs: closeOtherEditorTabs, onCloseTabsToRight: closeEditorTabsToRight, onCopyTabPath: copyEditorTabPath, onEditorGoToDefinition: (selection) => void goToDefinitionFromEditor(selection, "keyboard"), onEditorFindUsages: () => void findUsagesFromEditor(), onEditorFormatDocument: () => void formatActiveDocument(), onEditorCopyPath: copyActiveEditorPath, onToggleGitBlame: toggleGitBlame }}
      />
      <AppShellOverlays
        selectedBlameAttribution={selectedBlameAttribution}
        onCloseBlameCard={() => setSelectedBlameAttribution(null)}
        onShowSelectedBlameCommit={showSelectedBlameCommit}
        onShowSelectedBlameDiff={showSelectedBlameDiff}
        onShowSelectedLocalDiff={() => void showSelectedLocalDiff()}
        onCopySelectedBlameHash={copySelectedBlameHash}
        completionPopupVisible={completionPopupVisible}
        completionPopupProps={{ items: completionPresentationResults, selectedIndex: completionSelectedIndex, position: completionPopupPosition, anchor: completionAnchor, status: completionPresentationResults.length > 0 ? "ready" : completionStatus, message: completionMessage, detailsVisible: Boolean(selectedCompletionPresentation?.documentation || selectedCompletionPresentation?.definitionTarget), onAccept: insertCompletionItem, onSelect: setCompletionSelectedIndex }}
        overlayVisible={derived.overlayVisible}
        activeOverlay={activeOverlay}
        overlayLabel={derived.overlayLabel}
        onCloseOverlay={() => setActiveOverlay("none")}
        commandPaletteItems={commandPaletteItems}
        searchOverlayProps={{ quickOpenQuery, quickOpenResults: derived.quickOpenResults, recentFileResults: derived.recentFileResults, recentProjectResults: derived.recentProjectResults, searchEverywhereOptions, searchEverywhereMode, searchEverywhereScope, searchEverywhereReplaceQuery, searchSessionStore, workspacePartialNotice: derived.workspacePartialNotice, onChangeQuery: handleOverlayQueryChange, onChangeSearchEverywhereScope: setSearchEverywhereScope, onChangeSearchEverywhereReplaceQuery: setSearchEverywhereReplaceQuery, onOpenFile: (path) => void openFile(path), onOpenSearchEverywhereResult: (result) => void openSearchEverywhereResult(result.path, result.line, result.column), onOpenSearchEverywhereCandidate: (candidate) => void openSearchEverywhereCandidate(candidate), onOpenProject: (path) => void projectOpening.requestProjectOpen(path), onMoveSearchEverywhereSelection: moveSearchEverywhereSelection, onOpenSelectedSearchEverywhereResult: () => void openSelectedSearchEverywhereResult(), onSelectSearchEverywhereResult: setSearchEverywhereSelectedIndex, onToggleSearchEverywhereCaseSensitive: toggleSearchEverywhereCaseSensitive, onToggleSearchEverywhereWholeWord: toggleSearchEverywhereWholeWord, onSubmitGoToLine: submitGoToLine }}
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
        problems={problems} workspaceApi={workspaceApi} workspaceRootPath={workspace?.rootPath ?? null}
        buildState={buildState} buildModules={buildProject?.modules ?? []} onChangeBuildTarget={(lastTarget) => updateBuildState({ lastTarget })} onChangeBuildModuleName={(moduleName) => updateBuildState({ moduleName })} onChangeBuildProduct={(product) => updateBuildState({ product })} onChangeBuildMode={(buildMode) => updateBuildState({ buildMode })} onChangeBuildFastMode={(fastMode) => updateBuildState({ fastMode })} onSelectBuildConfiguration={selectBuildConfiguration} onSaveBuildConfiguration={() => void saveBuildConfiguration()} onCopyBuildConfiguration={() => void copyBuildConfiguration()} onDeleteBuildConfiguration={() => void deleteBuildConfiguration()} onRunBuild={() => void runBuild()} onRunCleanBuild={() => void runBuild(true)} onStopBuild={() => void stopBuild()}
        diffFiles={diffFiles} gitToolView={gitToolView} gitTraceState={gitTraceState} onChangeGitToolView={setGitToolView} onOpenGitFile={(path) => void openFile(path)} onFocusEditorFromGitTrace={focusEditorSoon} onOpenGitTraceCommitDiff={openGitTraceCommitDiff} onStatusChange={setStatusText}
        indexAndStatus={{ activeBottomTool, activePath, definitionDebugText, latestExplainResult, latestExplainQuery: latestExplainContext?.query ?? "", onOpenIndexExplainPanel: () => setIndexExplainPanelVisible(true), indexExplainPanelVisible, onCloseIndexExplainPanel: () => setIndexExplainPanelVisible(false), onRebuildIndexFromExplainPanel: () => void rebuildIndexFromExplainPanel(), onOpenSettingsFromExplainPanel: () => void openSettingsFromExplainPanel(), onRetryLatestExplainQuery: retryLatestExplainQuery, indexDiagnosticsVisible, indexDiagnosticsLoading, currentFileDirty: activeDocumentProjection.isDirty, indexDiagnostics, currentFileReadiness, layerReadiness, recentQueryExplains, uiLatencySamples, renderPressureSamples, ipcLatencySamples, workspaceIndexTaskStatuses, onCloseIndexDiagnostics: () => setIndexDiagnosticsVisible(false), onRefreshIndexDiagnostics: () => void refreshIndexDiagnostics(), onResumeIndexingFromDiagnostics: () => void resumeIndexingFromDiagnostics(), onRebuildSdkIndexFromDiagnostics: () => void rebuildSdkIndexFromDiagnostics(), onConfigureSdkFromDiagnostics: () => void openSettings(), semanticState, semanticCapability: derived.semanticCapability, statusText, workspaceName: workspace?.rootName ?? null, workspaceScanText: derived.workspaceScanText, workspaceIndexText: derived.workspaceIndexText, sdkIndexText: derived.sdkIndexText, buildMessage: buildState.message, currentLineBlame, gitBlameVisible, gitBlameMenuOpen, onToggleGitBlameMenu: toggleGitBlameMenu, onToggleGitBlame: toggleGitBlame, onRefreshGitBlame: refreshGitBlame, onShowCurrentLineBlame: showCurrentLineBlame, onCloseGitBlame: closeGitBlame, onOpenIndexDiagnostics: openIndexDiagnostics }}
      />
    </div>
  );
}
