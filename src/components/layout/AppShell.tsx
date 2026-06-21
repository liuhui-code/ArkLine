import { useCallback, useEffect, useRef, useState } from "react";
import { BottomToolWindow } from "@/components/layout/BottomToolWindow";
import { EditorSurface } from "@/components/layout/EditorSurface";
import { EnvironmentPanel } from "@/components/layout/EnvironmentPanel";
import { GitToolWindow } from "@/components/layout/GitToolWindow";
import { OpenProjectDecisionDialog } from "@/components/layout/OpenProjectDecisionDialog";
import { OpenProjectDialog } from "@/components/layout/OpenProjectDialog";
import { OverlaySurface } from "@/components/layout/OverlaySurface";
import { ProblemsPanel } from "@/components/layout/ProblemsPanel";
import { filterRecentFileResults, filterRecentProjectResults, getOverlayLabel } from "@/components/layout/search-overlay-model";
import type { BottomToolKey, LeftToolKey, OverlayKey } from "@/components/layout/shell-state";
import { ShellSidebar } from "@/components/layout/ShellSidebar";
import type { ShellCommand } from "@/components/layout/shell-keymap";
import { SearchOverlayContent } from "@/components/layout/SearchOverlayContent";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
import { TerminalToolWindow } from "@/components/layout/TerminalToolWindow";
import { TopBar } from "@/components/layout/TopBar";
import { UsagesPanel } from "@/components/layout/UsagesPanel";
import { useProjectOpening } from "@/components/layout/use-project-opening";
import { useShellHotkeys } from "@/components/layout/useShellHotkeys";
import { buildAppShellCommandPaletteItems, parseGoToLineQuery } from "@/components/layout/app-shell-helpers";
import { useHydratedSettings } from "@/components/layout/use-hydrated-settings";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { formatArkTsDocument } from "@/features/documents/arkts-format";
import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";
import { parseUnifiedDiff, type DiffFile } from "@/features/diff/unified-diff";
import { createProblemsStore, type ProblemItem } from "@/features/problems/problems-store";
import { useSemanticState } from "@/features/semantic/use-semantic-state";
import { rankPaths } from "@/features/search/fuzzy-matcher";
import { createSettingsStore, type AppSettingsPatch } from "@/features/settings/settings-store";
import { useTerminalToolWindow } from "@/features/terminal/use-terminal-tool-window";
import { findWorkspaceDefinition } from "@/features/workspace/local-definition";
import { idleUsageSearchState, type UsageResult, type UsageSearchState } from "@/features/workspace/usage-search";
import { defaultWorkspaceApi, toWorkspaceViewModel, type EnvironmentReport, type LanguageCompletionItem, type WorkspaceApi, type WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

type AppShellProps = { workspaceApi?: WorkspaceApi };
export function AppShell({ workspaceApi = defaultWorkspaceApi }: AppShellProps) {
  const canUseNativeProjectPicker = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [filesVisible, setFilesVisible] = useState(true);
  const [searchVisible, setSearchVisible] = useState(false);
  const [bottomVisible, setBottomVisible] = useState(true);
  const [activeLeftTool, setActiveLeftTool] = useState<LeftToolKey>("project");
  const [activeBottomTool, setActiveBottomTool] = useState<BottomToolKey>("problems");
  const [workspace, setWorkspace] = useState<WorkspaceViewModel | null>(null);
  const [openTabs, setOpenTabs] = useState<{ path: string; title: string; isDirty: boolean }[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null), [editorContent, setEditorContent] = useState("");
  const [searchQuery, setSearchQuery] = useState(""), [activeOverlay, setActiveOverlay] = useState<OverlayKey>("none");
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]), [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [environmentReport, setEnvironmentReport] = useState<EnvironmentReport | null>(null);
  const [editorAppearance, setEditorAppearance] = useState(createSettingsStore().state.settings.editor);
  const [editorFocusToken, setEditorFocusToken] = useState(0);
  const [selectionTarget, setSelectionTarget] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [insertTextTarget, setInsertTextTarget] = useState<{ text: string; nonce: number } | null>(null);
  const [editorSelection, setEditorSelection] = useState({ line: 1, column: 1 });
  const [completionItems, setCompletionItems] = useState<LanguageCompletionItem[]>([]);
  const [usageSearch, setUsageSearch] = useState<UsageSearchState>(idleUsageSearchState());
  const [definitionDebugText, setDefinitionDebugText] = useState("");
  const [statusText, setStatusText] = useState("Mode: shell bootstrap");
  const documentsRef = useRef(createDocumentStore());
  const tabsRef = useRef(createEditorTabsStore(documentsRef.current));
  const problemsRef = useRef(createProblemsStore());
  const settingsRef = useRef(createSettingsStore());
  const filesPaneRef = useRef<HTMLDivElement | null>(null);
  const searchPaneRef = useRef<HTMLDivElement | null>(null);
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const bottomToolWindowRef = useRef<HTMLElement | null>(null);
  const { semanticState, refreshSemanticState } = useSemanticState(workspaceApi);
  const terminalToolWindow = useTerminalToolWindow({ workspaceApi, workspaceRootPath: workspace?.rootPath ?? null, onStatusChange: setStatusText });
  const projectOpening = useProjectOpening({ canUseNativeProjectPicker, hasWorkspace: workspace !== null, workspaceApi, workspaceRootPath: workspace?.rootPath ?? null, openWorkspace, focusEditorSoon, onBeforeProjectOpen: () => setActiveOverlay("none"), onStatusChange: setStatusText });
  function focusEditor() { const editor = editorSurfaceRef.current?.querySelector<HTMLElement>('[aria-label="Editor Content"]'); if (editor) return void editor.focus(); editorSurfaceRef.current?.focus(); }
  function focusEditorSoon() { requestAnimationFrame(() => focusEditor()); }
  function setDefinitionDebug(message: string) { setDefinitionDebugText(message); }
  function setOverlay(overlay: Exclude<OverlayKey, "none">) { setActiveOverlay(overlay); setQuickOpenQuery(""); setStatusText(getOverlayLabel(overlay)); }

  function showLeftTool(tool: LeftToolKey) {
    if (tool === "project") {
      const nextVisible = activeLeftTool !== "project" || !filesVisible;
      setActiveLeftTool("project");
      setFilesVisible(nextVisible);
      setSearchVisible(false);
      setStatusText(nextVisible ? "Project" : "Editor");
      return;
    }
    if (tool === "search") {
      const nextVisible = activeLeftTool !== "search" || !searchVisible;
      setActiveLeftTool("search");
      setSearchVisible(nextVisible);
      setFilesVisible(false);
      setStatusText(nextVisible ? "Search" : "Editor");
      return;
    }
    setActiveLeftTool(tool);
    setBottomVisible(true); setActiveBottomTool(tool === "git" ? "git" : "problems"); setStatusText(tool === "git" ? "Git" : "Problems");
  }
  function showBottomTool(tool: BottomToolKey) {
    setBottomVisible(true);
    setActiveBottomTool(tool);
    setStatusText(tool === "terminal" ? "Terminal" : tool === "git" ? "Git" : tool === "usages" ? "Usages" : "Problems");
    if (tool === "terminal") {
      void terminalToolWindow.ensureSession();
    }
  }
  function openUsagesToolWindow() {
    setBottomVisible(true);
    setActiveBottomTool("usages");
    setStatusText("Usages");
  }

  function closeTransientUi() {
    if (activeOverlay !== "none") {
      setActiveOverlay("none");
      focusEditor();
      return true;
    }
    if (projectOpening.projectPickerVisible) {
      projectOpening.closeProjectPicker();
      focusEditor();
      return true;
    }
    if (projectOpening.projectDecisionVisible) {
      projectOpening.cancelPendingProjectOpen();
      focusEditor();
      return true;
    }
    if (settingsVisible) {
      setSettingsVisible(false);
      focusEditor();
      return true;
    }
    return false;
  }

  function closeActiveFile() {
    if (!tabsRef.current.state.activePath) {
      return;
    }
    tabsRef.current.closeTab(tabsRef.current.state.activePath);
    syncTabs();
    setActiveDocument(tabsRef.current.state.activePath);
    setCompletionItems([]);
    setInsertTextTarget(null);
    setSelectionTarget(null);
    setStatusText(tabsRef.current.state.activePath ? `Closed ${getPathBasename(activePath ?? "")}` : "Closed file");
    focusEditorSoon();
  }

  function hideActiveToolWindow() {
    if (closeTransientUi()) return;
    const activeElement = document.activeElement;
    const focusTargets = [
      [bottomVisible, bottomToolWindowRef.current, () => setBottomVisible(false)],
      [searchVisible, searchPaneRef.current, () => setSearchVisible(false)],
      [filesVisible, filesPaneRef.current, () => setFilesVisible(false)],
    ] as const;
    const focusedTarget = activeElement instanceof Node
      ? focusTargets.find(([, container]) => container?.contains(activeElement))
      : null;
    if (focusedTarget) { focusedTarget[2](); focusEditor(); return; }
    const visibleTarget = focusTargets.find(([visible]) => visible);
    if (visibleTarget) { visibleTarget[2](); focusEditor(); }
  }

  function enterEditorOnlyMode() {
    setActiveOverlay("none");
    setSettingsVisible(false);
    setFilesVisible(false);
    setSearchVisible(false);
    setBottomVisible(false);
    setStatusText("Editor Only");
    focusEditor();
  }

  function syncTabs() { setOpenTabs([...tabsRef.current.state.openTabs]); }
  function syncEditor(path: string | null) { setEditorContent(path ? documentsRef.current.getDocument(path)?.currentContent ?? "" : ""); }
  function setActiveDocument(path: string | null) { setActivePath(path); syncEditor(path); }
  function applyWorkspaceSnapshot(snapshot: WorkspaceViewModel) {
    setWorkspace(snapshot);
    setRecentProjects((items) => {
      const next = [snapshot.rootPath, ...items.filter((item) => item !== snapshot.rootPath)].slice(0, 8);
      settingsRef.current.update({ recentProjects: next });
      void workspaceApi.saveSettings(settingsRef.current.state.settings);
      return next;
    });
  }

  function resetWorkspaceUi(rootName: string) {
    tabsRef.current.state.openTabs = [];
    tabsRef.current.state.activePath = null;
    setOpenTabs([]);
    setActiveDocument(null);
    setSearchQuery("");
    setQuickOpenQuery("");
    projectOpening.closeProjectPicker();
    projectOpening.setProjectPathInput("");
    setActiveOverlay("none");
    setProblems([]);
    setDiffFiles([]);
    setCompletionItems([]);
    setUsageSearch(idleUsageSearchState());
    terminalToolWindow.resetSessions();
    setEditorSelection({ line: 1, column: 1 });
    setInsertTextTarget(null);
    setSelectionTarget(null);
    setBottomVisible(true);
    setStatusText(`Workspace ready: ${rootName}`);
  }

  async function openWorkspace(rootPath: string) {
    try {
      const snapshot = await workspaceApi.openWorkspace(rootPath);
      applyWorkspaceSnapshot(toWorkspaceViewModel(snapshot));
      resetWorkspaceUi(snapshot.rootName);
      await refreshSemanticState();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      projectOpening.setProjectPathInput(rootPath);
      projectOpening.setProjectOpenError(message);
      setStatusText(`Open Project failed: ${message}`);
    }
  }
  async function openDemoWorkspace() { const snapshot = await workspaceApi.openDemoWorkspace(); applyWorkspaceSnapshot(toWorkspaceViewModel(snapshot)); resetWorkspaceUi(snapshot.rootName); }
  useEffect(() => {
    let disposed = false;
    if (workspace) return;
    void (async () => {
      const launchRootPath = await workspaceApi.getLaunchWorkspacePath?.();
      if (!launchRootPath || disposed) return;
      await openWorkspace(launchRootPath);
    })();
    return () => { disposed = true; };
  }, [workspace, workspaceApi]);

  async function openFile(path: string) {
    const content = await workspaceApi.openFile(path);
    if (!documentsRef.current.getDocument(path)) documentsRef.current.openDocument(path, content);
    tabsRef.current.openTab(path);
    syncTabs();
    setActiveDocument(path);
    setCompletionItems([]);
    setEditorSelection({ line: 1, column: 1 });
    setInsertTextTarget(null);
    setSelectionTarget(null);
    setActiveOverlay("none");
    setQuickOpenQuery("");
    setEditorFocusToken((token) => token + 1);
    setStatusText(`Opened ${getPathBasename(path)}`);
  }

  async function goToDefinitionFromEditor(
    selectionOverride?: { line: number; column: number },
    source: "keyboard" | "modifierClick" = "keyboard",
  ) {
    if (source === "modifierClick" && !selectionOverride) {
      setDefinitionDebug("Ctrl+Click reached AppShell, but the editor could not resolve a document position.");
      setStatusText("Ctrl+Click received, but editor position could not be resolved");
      return;
    }
    if (!activePath || !workspaceApi.gotoDefinition) {
      if (source === "modifierClick") setDefinitionDebug("Ctrl+Click reached AppShell, but definition lookup is unavailable for the current workspace.");
      setStatusText("Go to Definition unavailable");
      return;
    }
    const request = {
      path: activePath,
      line: selectionOverride?.line ?? editorSelection.line,
      column: selectionOverride?.column ?? editorSelection.column,
    };
    setStatusText(
      `${source === "modifierClick" ? "Ctrl+Click" : "Go to Definition"} query: ${getPathBasename(activePath)}:${request.line}:${request.column}`,
    );
    if (source === "modifierClick") {
      setDefinitionDebug(`Ctrl+Click query fired at ${getPathBasename(activePath)}:${request.line}:${request.column}. Waiting for language lookup...`);
    }
    const target = await workspaceApi.gotoDefinition(request);
    const resolvedTarget = target ?? await findWorkspaceDefinition({
      path: activePath,
      content: documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent,
      line: request.line,
      column: request.column,
      workspaceFiles: workspace?.visibleFiles ?? [activePath],
      readFile: async (path) => {
        if (normalizePath(path) === normalizePath(activePath)) {
          return documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
        }
        try {
          return await workspaceApi.openFile(path);
        } catch {
          return null;
        }
      },
    });
    if (!resolvedTarget) {
      if (source === "modifierClick") setDefinitionDebug("Ctrl+Click query ran, but both the language service and same-file fallback returned no definition target.");
      setStatusText(
        `${source === "modifierClick" ? "Ctrl+Click" : "Go to Definition"} miss: language service and local fallback returned no target`,
      );
      return;
    }
    if (normalizePath(resolvedTarget.path) !== normalizePath(activePath)) await openFile(resolvedTarget.path);
    setSelectionTarget({
      line: resolvedTarget.line,
      column: resolvedTarget.column,
      nonce: Date.now(),
    });
    setEditorFocusToken((token) => token + 1);
    setStatusText(
      `${target ? "Definition" : "Definition fallback"}: ${getPathBasename(resolvedTarget.path)}:${resolvedTarget.line}:${resolvedTarget.column}`,
    );
    if (source === "modifierClick") {
      setDefinitionDebug(
        `${target ? "Language service" : "Same-file fallback"} resolved Ctrl+Click to ${getPathBasename(resolvedTarget.path)}:${resolvedTarget.line}:${resolvedTarget.column}.`,
      );
    }
    focusEditorSoon();
  }

  async function openCompletionFromEditor() {
    if (!activePath || !workspaceApi.completeSymbol) return void setStatusText("Completion unavailable");
    const results = await workspaceApi.completeSymbol({ path: activePath, line: editorSelection.line, column: editorSelection.column });
    setCompletionItems(results); setQuickOpenQuery(""); setActiveOverlay("completion"); setStatusText(results.length > 0 ? `Completion: ${results.length} items` : "Completion empty");
  }
  async function findUsagesFromEditor() {
    openUsagesToolWindow();
    if (!activePath || !workspaceApi.findUsages) {
      setUsageSearch({ status: "error", items: [], message: "Find Usages unavailable" });
      return;
    }
    const request = { path: activePath, line: editorSelection.line, column: editorSelection.column };
    setUsageSearch({ status: "loading", items: [], requestedSymbol: request });
    try {
      const items = await workspaceApi.findUsages(request);
      setUsageSearch({
        status: items.length > 0 ? "ready" : "empty",
        items,
        requestedSymbol: request,
        message: items.length > 0 ? undefined : "No usages found",
      });
      setStatusText(items.length > 0 ? `Usages: ${items.length} matches` : "Usages: none");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUsageSearch({ status: "error", items: [], requestedSymbol: request, message });
      setStatusText(`Find Usages failed: ${message}`);
    }
  }
  function insertCompletion(label: string) { setInsertTextTarget({ text: label, nonce: Date.now() }); setCompletionItems([]); setActiveOverlay("none"); setEditorFocusToken((token) => token + 1); setStatusText(`Inserted completion: ${label}`); focusEditorSoon(); }
  async function openUsageResult(item: UsageResult) {
    if (normalizePath(item.path) !== normalizePath(activePath ?? "")) await openFile(item.path);
    setSelectionTarget({ line: item.line, column: item.column, nonce: Date.now() });
    setEditorFocusToken((token) => token + 1);
    setStatusText(`Usage: ${getPathBasename(item.path)}:${item.line}:${item.column}`);
    focusEditorSoon();
  }

  function submitGoToLine() {
    if (!activePath) return;
    const nextTarget = parseGoToLineQuery(quickOpenQuery);
    if (!nextTarget) {
      setStatusText("Go to Line requires line or line:column");
      return;
    }

    setSelectionTarget({
      ...nextTarget,
      nonce: Date.now(),
    });
    setEditorFocusToken((token) => token + 1);
    setActiveOverlay("none");
    setStatusText(`Line ${nextTarget.line}${nextTarget.column > 1 ? `:${nextTarget.column}` : ""}`);
    focusEditorSoon();
  }

  function handleEditorChange(content: string) {
    if (!activePath) return;
    documentsRef.current.updateDocument(activePath, content);
    syncTabs();
    syncEditor(activePath);
    setStatusText("Modified");
  }
  async function refreshProblems(path: string, content: string) { problemsRef.current.replace(await workspaceApi.runValidation(path, content)); setProblems([...problemsRef.current.state.items]); }

  async function runLint() {
    if (!activePath) return;
    await refreshProblems(activePath, editorContent);
    setBottomVisible(true);
    setActiveBottomTool("problems");
    setStatusText("Lint complete");
  }

  async function formatActiveDocument() {
    if (!activePath) return;
    const content = documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
    const formatted = formatArkTsDocument(content);
    documentsRef.current.updateDocument(activePath, formatted);
    syncTabs();
    setEditorContent(formatted);
    await refreshProblems(activePath, formatted);
    setBottomVisible(true);
    setActiveBottomTool("problems");
    setStatusText(`Formatted ${getPathBasename(activePath)}`);
  }

  async function saveActiveDocument() {
    if (!activePath) return;
    const currentContent = documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
    const content = settingsRef.current.state.settings.validation.formatOnSave
      ? formatArkTsDocument(currentContent)
      : currentContent;
    if (content !== currentContent) documentsRef.current.updateDocument(activePath, content);
    await workspaceApi.saveFile(activePath, content);
    documentsRef.current.saveDocument(activePath);
    syncTabs();
    setEditorContent(content);
    await refreshProblems(activePath, content);
    setStatusText(`Saved ${getPathBasename(activePath)}`);
  }

  async function loadDiff() {
    const diffText = await workspaceApi.loadDiff(workspace?.rootPath ?? null);
    setDiffFiles(parseUnifiedDiff(diffText));
    setBottomVisible(true);
    setActiveBottomTool("git");
    setStatusText(diffText ? "Diff loaded" : "No diff");
  }

  async function openSettings() { setSettingsVisible(true); setEnvironmentReport(await workspaceApi.inspectEnvironment()); setStatusText("Settings"); }
  function updateSettings(update: AppSettingsPatch) { settingsRef.current.update(update); setEditorAppearance({ ...settingsRef.current.state.settings.editor }); void workspaceApi.saveSettings(settingsRef.current.state.settings); }
  const handleHydratedSettings = useCallback((settings: ReturnType<typeof createSettingsStore>["state"]["settings"]) => { setEditorAppearance({ ...settings.editor }); setRecentProjects([...settings.recentProjects]); }, []);
  useHydratedSettings({ workspaceApi, settingsRef, onHydrated: handleHydratedSettings });

  useShellHotkeys({ onCommand(command: ShellCommand) {
    const handlers: Partial<Record<ShellCommand, () => void>> = {
      closeTransientUi, closeActiveFile, hideActiveToolWindow, toggleEditorOnly: enterEditorOnlyMode,
      openQuickOpen: () => setOverlay("quickOpen"), openSearchEverywhere: () => setOverlay("searchEverywhere"), openRecentFiles: () => setOverlay("recentFiles"), openCommandPalette: () => setOverlay("commandPalette"), openCompletion: () => void openCompletionFromEditor(),
      showProject: () => showLeftTool("project"), showProblems: () => showBottomTool("problems"), showGit: () => showBottomTool("git"), showTerminal: () => showBottomTool("terminal"), goToDefinition: () => void goToDefinitionFromEditor(), findUsages: () => void findUsagesFromEditor(),
    };
    const handler = handlers[command];
    if (handler) return handler();
    void saveActiveDocument();
  } });

  const quickOpenResults = workspace ? rankPaths(workspace.visibleFiles, quickOpenQuery || searchQuery, 8) : [];
  const searchResults = workspace ? rankPaths(workspace.visibleFiles, searchQuery, 12) : [];
  const searchEverywhereResults = workspace ? rankPaths(workspace.visibleFiles, quickOpenQuery, 8) : [];
  const recentFileResults = filterRecentFileResults(tabsRef.current.state.recentFiles.map((path) => ({ path, title: getPathBasename(path) })), quickOpenQuery);
  const recentProjectResults = filterRecentProjectResults(recentProjects.map((path) => ({ path, name: getPathBasename(path) })), quickOpenQuery);
  const completionResults = completionItems.filter((item) => { const query = quickOpenQuery.trim().toLowerCase(); return !query || item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query); });
  const commandPaletteItems = buildAppShellCommandPaletteItems(quickOpenQuery, { openProject: () => void projectOpening.openProjectPicker(), openDemoWorkspace: () => void openDemoWorkspace(), openRecentProjects: () => setOverlay("recentProjects"), openGoToLine: () => setOverlay("goToLine"), goToDefinition: () => void goToDefinitionFromEditor(), findUsages: () => void findUsagesFromEditor(), openCompletion: () => void openCompletionFromEditor(), runLint: () => void runLint(), formatActiveDocument: () => void formatActiveDocument(), loadDiff: () => void loadDiff(), openSettings: () => void openSettings() });
  const overlayLabel = activeOverlay === "none" ? "Quick Open" : getOverlayLabel(activeOverlay);
  return (
    <div className="app-shell">
      <TopBar activeBottomTool={activeBottomTool} activeOverlay={activeOverlay} workspaceName={workspace?.rootName ?? null} settingsOpen={settingsVisible} onOpenProject={() => void projectOpening.openProjectPicker()} onOpenRecentProjects={() => setOverlay("recentProjects")} onOpenSearchEverywhere={() => setOverlay("searchEverywhere")} onOpenCommandPalette={() => setOverlay("commandPalette")} onRunLint={() => void runLint()} onFormat={() => void formatActiveDocument()} onLoadDiff={() => void loadDiff()} onOpenTerminal={() => showBottomTool("terminal")} onOpenSettings={() => void openSettings()} onToggleEditorOnly={enterEditorOnlyMode} />
      <div className="shell-grid">
        <ShellSidebar activePath={activePath} activeTool={activeLeftTool} filesVisible={filesVisible} searchQuery={searchQuery} searchResults={searchResults} searchVisible={searchVisible} workspace={workspace} filesPaneRef={filesPaneRef} searchPaneRef={searchPaneRef} onOpenFile={(path) => void openFile(path)} onSearchQueryChange={setSearchQuery} onSelectTool={showLeftTool} />
        <EditorSurface activePath={activePath} content={editorContent} openTabs={openTabs} appearance={editorAppearance} focusToken={editorFocusToken} insertTextTarget={insertTextTarget} selectionTarget={selectionTarget} workspaceName={workspace?.rootName ?? null} surfaceRef={editorSurfaceRef} onChange={handleEditorChange} onSelectionChange={setEditorSelection} onDefinitionTrigger={(selection) => void goToDefinitionFromEditor(selection, "modifierClick")} onSelectTab={setActiveDocument} />
      </div>
      <OverlaySurface activeOverlay={activeOverlay} label={overlayLabel}>
        <SearchOverlayContent activeOverlay={activeOverlay} commandPaletteItems={commandPaletteItems} completionResults={completionResults} quickOpenQuery={quickOpenQuery} quickOpenResults={quickOpenResults} recentFileResults={recentFileResults} recentProjectResults={recentProjectResults} searchEverywhereResults={searchEverywhereResults} onChangeQuery={setQuickOpenQuery} onOpenFile={(path) => void openFile(path)} onOpenProject={(path) => void projectOpening.requestProjectOpen(path)} onInsertCompletion={insertCompletion} onSubmitGoToLine={submitGoToLine} onCloseOverlay={() => setActiveOverlay("none")} />
      </OverlaySurface>

      <OpenProjectDialog
        open={projectOpening.projectPickerVisible}
        errorMessage={projectOpening.projectOpenError}
        projectPath={projectOpening.projectPathInput}
        onChangeProjectPath={projectOpening.setProjectPathInput}
        onClose={projectOpening.closeProjectPicker}
        onOpenProject={() => void projectOpening.confirmOpenProject()}
      />
      <OpenProjectDecisionDialog
        open={projectOpening.projectDecisionVisible}
        projectName={getPathBasename(projectOpening.pendingProjectPath ?? "") || "Project"}
        onChooseThisWindow={() => void projectOpening.openPendingProjectInThisWindow()}
        onChooseNewWindow={() => void projectOpening.openPendingProjectInNewWindow()}
        onCancel={projectOpening.cancelPendingProjectOpen}
      />

      <SettingsDialog open={settingsVisible} settings={settingsRef.current.state.settings} onClose={() => setSettingsVisible(false)} onChange={updateSettings} />
      <EnvironmentPanel report={environmentReport} visible={settingsVisible} />
      <BottomToolWindow
        containerRef={bottomToolWindowRef} activeTool={activeBottomTool} onSelectTool={showBottomTool} visible={bottomVisible} problemsPanel={<ProblemsPanel problems={problems} />}
        terminalPanel={<TerminalToolWindow sessions={terminalToolWindow.sessions} activeSessionId={terminalToolWindow.activeSessionId} focusToken={terminalToolWindow.focusToken} output={terminalToolWindow.outputBySession[terminalToolWindow.activeSessionId ?? ""] ?? ""} onInput={(data) => void terminalToolWindow.writeInput(data)} onCreateSession={() => void terminalToolWindow.createSession()} onCloseSession={(sessionId) => void terminalToolWindow.closeSession(sessionId)} onSetActiveSession={terminalToolWindow.setActiveSession} onClearSession={terminalToolWindow.clearSession} onStopSession={() => void terminalToolWindow.stopSession()} />}
        gitPanel={<GitToolWindow files={diffFiles} onOpenFile={(path) => void openFile(path)} />}
        usagesPanel={<UsagesPanel state={usageSearch} onOpenUsage={(item) => void openUsageResult(item)} />}
      />
      <div
        aria-label="Definition Debug Banner"
        aria-live="polite"
        className={`definition-debug-banner${definitionDebugText ? " definition-debug-banner--visible" : ""}`}
        hidden={!definitionDebugText}
      >
        {definitionDebugText}
      </div>
      <ShellStatusBar activeBottomTool={activeBottomTool} activePath={activePath} semanticState={semanticState} statusText={statusText} workspaceName={workspace?.rootName ?? null} terminalRunning={false} />
    </div>
  );
}
