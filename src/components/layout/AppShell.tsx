import { useCallback, useEffect, useRef, useState } from "react";
import { BottomToolWindow } from "@/components/layout/BottomToolWindow";
import { EditorSurface } from "@/components/layout/EditorSurface";
import { GitToolWindow } from "@/components/layout/GitToolWindow";
import { GitTracePanel } from "@/components/layout/GitTracePanel";
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
import { TerminalToolWindowHost } from "@/components/layout/TerminalToolWindowHost";
import { TopBar } from "@/components/layout/TopBar";
import { UsagesPanel } from "@/components/layout/UsagesPanel";
import { useProjectOpening } from "@/components/layout/use-project-opening";
import { useShellHotkeys } from "@/components/layout/useShellHotkeys";
import { buildAppShellCommandPaletteItems, extractCompletionPrefix, parseGoToLineQuery } from "@/components/layout/app-shell-helpers";
import { useHydratedSettings } from "@/components/layout/use-hydrated-settings";
import { useGitTrace } from "@/components/layout/use-git-trace";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { formatArkTsDocument } from "@/features/documents/arkts-format";
import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";
import { parseUnifiedDiff, type DiffFile } from "@/features/diff/unified-diff";
import { createProblemsStore, type ProblemItem } from "@/features/problems/problems-store";
import {
  searchWorkspaceText,
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import { useSemanticState } from "@/features/semantic/use-semantic-state";
import { rankPaths } from "@/features/search/fuzzy-matcher";
import { createSettingsStore, type AppSettings } from "@/features/settings/settings-store";
import { findWorkspaceDefinition, findWorkspaceDefinitionCandidates } from "@/features/workspace/local-definition";
import { idleUsageSearchState, type UsageResult, type UsageSearchState } from "@/features/workspace/usage-search";
import { defaultWorkspaceApi, toWorkspaceViewModel, type EnvironmentReport, type LanguageCompletionItem, type WorkspaceApi, type WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

type AppShellProps = { workspaceApi?: WorkspaceApi };
type NavigationLocation = { path: string; line: number; column: number };
export function AppShell({ workspaceApi = defaultWorkspaceApi }: AppShellProps) {
  const canUseNativeProjectPicker = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [filesVisible, setFilesVisible] = useState(true);
  const [bottomVisible, setBottomVisible] = useState(true);
  const [activeLeftTool, setActiveLeftTool] = useState<LeftToolKey>("project");
  const [activeBottomTool, setActiveBottomTool] = useState<BottomToolKey>("problems");
  const [workspace, setWorkspace] = useState<WorkspaceViewModel | null>(null);
  const [openTabs, setOpenTabs] = useState<{ path: string; title: string; isDirty: boolean }[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null), [editorContent, setEditorContent] = useState("");
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey>("none");
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [searchEverywhereOptions, setSearchEverywhereOptions] = useState<WorkspaceTextSearchOptions>({
    caseSensitive: false,
    wholeWord: false,
  });
  const [searchEverywhereResult, setSearchEverywhereResult] = useState<WorkspaceTextSearchResult>({
    query: { kind: "text", query: "" },
    matches: [],
  });
  const [searchEverywhereSelectedIndex, setSearchEverywhereSelectedIndex] = useState(0);
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]), [recentProjects, setRecentProjects] = useState<string[]>([]);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [settingsSaveState, setSettingsSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [environmentReport, setEnvironmentReport] = useState<EnvironmentReport | null>(null);
  const [editorAppearance, setEditorAppearance] = useState(createSettingsStore().state.settings.editor);
  const [editorFocusToken, setEditorFocusToken] = useState(0);
  const [selectionTarget, setSelectionTarget] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [insertTextTarget, setInsertTextTarget] = useState<{ text: string; replaceBefore?: number; nonce: number } | null>(null);
  const [editorSelection, setEditorSelection] = useState({ line: 1, column: 1 });
  const [completionItems, setCompletionItems] = useState<LanguageCompletionItem[]>([]);
  const [completionReplacePrefix, setCompletionReplacePrefix] = useState("");
  const [completionSelectedIndex, setCompletionSelectedIndex] = useState(0);
  const [usageSearch, setUsageSearch] = useState<UsageSearchState>(idleUsageSearchState());
  const [definitionDebugText, setDefinitionDebugText] = useState("");
  const [statusText, setStatusText] = useState("Mode: shell bootstrap");
  const [definitionHoverActive, setDefinitionHoverActive] = useState(false);
  const [completionAutoFocus, setCompletionAutoFocus] = useState(true);
  const documentsRef = useRef(createDocumentStore());
  const tabsRef = useRef(createEditorTabsStore(documentsRef.current));
  const problemsRef = useRef(createProblemsStore());
  const settingsRef = useRef(createSettingsStore());
  const filesPaneRef = useRef<HTMLDivElement | null>(null);
  const editorSurfaceRef = useRef<HTMLElement | null>(null);
  const bottomToolWindowRef = useRef<HTMLElement | null>(null);
  const navigationHistoryRef = useRef<NavigationLocation[]>([]);
  const completionRecencyRef = useRef(new Map<string, number>());
  const completionRecencyCounterRef = useRef(0);
  const searchEverywhereRequestRef = useRef(0);
  const settingsSaveResetTimerRef = useRef<number | null>(null);
  const typingCompletionTimerRef = useRef<number | null>(null);
  const { semanticState, refreshSemanticState } = useSemanticState(workspaceApi);
  const activeTab = activePath
    ? openTabs.find((tab) => normalizePath(tab.path) === normalizePath(activePath))
    : null;
  const { gitTraceState } = useGitTrace({
    activeLine: editorSelection.line,
    activePath,
    isActiveFileDirty: activeTab?.isDirty ?? false,
    activeTool: activeBottomTool,
    workspaceApi,
  });
  const projectOpening = useProjectOpening({ canUseNativeProjectPicker, hasWorkspace: workspace !== null, workspaceApi, workspaceRootPath: workspace?.rootPath ?? null, openWorkspace, focusEditorSoon, onBeforeProjectOpen: () => setActiveOverlay("none"), onStatusChange: setStatusText });
  function focusEditor() { const editor = editorSurfaceRef.current?.querySelector<HTMLElement>('[aria-label="Editor Content"]'); if (editor) return void editor.focus(); editorSurfaceRef.current?.focus(); }
  function focusEditorSoon() { requestAnimationFrame(() => focusEditor()); }
  function isEditorFocused() {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLElement)) {
      return false;
    }

    return activeElement.getAttribute("aria-label") === "Editor Content"
      || !!editorSurfaceRef.current?.contains(activeElement);
  }
  function setDefinitionDebug(message: string) { setDefinitionDebugText(message); }
  function setOverlay(overlay: Exclude<OverlayKey, "none">) {
    setActiveOverlay(overlay);
    setQuickOpenQuery("");
    setSearchEverywhereSelectedIndex(0);
    setStatusText(getOverlayLabel(overlay));
  }
  function handleOverlayQueryChange(value: string) {
    setQuickOpenQuery(value);
    if (activeOverlay === "completion") {
      setCompletionSelectedIndex(0);
    }
  }
  function clearTypingCompletionTimer() {
    if (typingCompletionTimerRef.current != null) {
      window.clearTimeout(typingCompletionTimerRef.current);
      typingCompletionTimerRef.current = null;
    }
  }
  function clearSettingsSaveResetTimer() {
    if (settingsSaveResetTimerRef.current != null) {
      window.clearTimeout(settingsSaveResetTimerRef.current);
      settingsSaveResetTimerRef.current = null;
    }
  }
  function rememberCurrentLocation() {
    if (!activePath) return;
    const next = {
      path: activePath,
      line: editorSelection.line,
      column: editorSelection.column,
    };
    const previous = navigationHistoryRef.current.at(-1);
    if (
      previous &&
      normalizePath(previous.path) === normalizePath(next.path) &&
      previous.line === next.line &&
      previous.column === next.column
    ) {
      return;
    }
    navigationHistoryRef.current.push(next);
  }
  async function navigateToLocation(
    location: NavigationLocation,
    statusPrefix: "Back" | "Definition" | "Usage" | "Line" = "Definition",
  ) {
    if (normalizePath(location.path) !== normalizePath(activePath ?? "")) {
      await openFile(location.path);
    }
    setSelectionTarget({
      line: location.line,
      column: location.column,
      nonce: Date.now(),
    });
    setEditorFocusToken((token) => token + 1);
    setStatusText(`${statusPrefix}: ${getPathBasename(location.path)}:${location.line}:${location.column}`);
    focusEditorSoon();
  }
  async function navigateBackFromHistory() {
    const target = navigationHistoryRef.current.pop();
    if (!target) {
      setStatusText("Back: no previous location");
      focusEditorSoon();
      return;
    }
    await navigateToLocation(target, "Back");
  }

  function showLeftTool(tool: LeftToolKey) {
    if (tool === "project") {
      const nextVisible = activeLeftTool !== "project" || !filesVisible;
      setActiveLeftTool("project");
      setFilesVisible(nextVisible);
      setStatusText(nextVisible ? "Project" : "Editor");
      return;
    }
    setActiveLeftTool(tool);
    setBottomVisible(true); setActiveBottomTool(tool === "git" ? "git" : "problems"); setStatusText(tool === "git" ? "Git" : "Problems");
  }
  function showBottomTool(tool: BottomToolKey) {
    setBottomVisible(true);
    setActiveBottomTool(tool);
    setStatusText(
      tool === "terminal" ? "Terminal"
      : tool === "git" ? "Git"
      : tool === "gitTrace" ? "Git Trace"
      : tool === "usages" ? "Usages"
      : "Problems",
    );
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
    setQuickOpenQuery("");
    projectOpening.closeProjectPicker();
    projectOpening.setProjectPathInput("");
    setActiveOverlay("none");
    setProblems([]);
    setDiffFiles([]);
    setCompletionItems([]);
    setUsageSearch(idleUsageSearchState());
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
    const semanticCandidates = target || !workspaceApi.gotoDefinitionCandidates
      ? []
      : await workspaceApi.gotoDefinitionCandidates(request);
    if (semanticCandidates.length > 1) {
      openUsagesToolWindow();
      setUsageSearch({
        status: "ready",
        items: semanticCandidates.map((item) => ({
          path: item.path,
          line: item.line,
          column: item.column,
          preview: item.preview,
        })),
        requestedSymbol: request,
        message: undefined,
      });
      setStatusText(`Definition candidates: ${semanticCandidates.length}`);
      if (source === "modifierClick") {
        setDefinitionDebug(
          `Ctrl+Click found ${semanticCandidates.length} semantic definition candidates. Choose one from the Usages panel.`,
        );
      }
      return;
    }
    const fallbackRequest = {
      path: activePath,
      content: documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent,
      line: request.line,
      column: request.column,
      workspaceFiles: workspace?.visibleFiles ?? [activePath],
      readFile: async (path: string) => {
        if (normalizePath(path) === normalizePath(activePath)) {
          return documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
        }
        try {
          return await workspaceApi.openFile(path);
        } catch {
          return null;
        }
      },
    };
    const resolvedTarget = target ?? await findWorkspaceDefinition(fallbackRequest);
    if (!resolvedTarget) {
      const fallbackCandidates = target ? [] : await findWorkspaceDefinitionCandidates(fallbackRequest);
      if (fallbackCandidates.length > 1) {
        openUsagesToolWindow();
        setUsageSearch({
          status: "ready",
          items: fallbackCandidates.map((item) => ({
            path: item.path,
            line: item.line,
            column: item.column,
            preview: item.preview,
          })),
          requestedSymbol: request,
          message: undefined,
        });
        setStatusText(`Definition candidates: ${fallbackCandidates.length}`);
        if (source === "modifierClick") {
          setDefinitionDebug(
            `Ctrl+Click found ${fallbackCandidates.length} fallback definition candidates. Choose one from the Usages panel.`,
          );
        }
        return;
      }
      if (source === "modifierClick") setDefinitionDebug("Ctrl+Click query ran, but both the language service and same-file fallback returned no definition target.");
      setStatusText(
        `${source === "modifierClick" ? "Ctrl+Click" : "Go to Definition"} miss: language service and local fallback returned no target`,
      );
      return;
    }
    rememberCurrentLocation();
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

  async function requestCompletion(
    trigger: "manual" | "typing",
    selectionOverride?: { line: number; column: number },
  ) {
    if (!activePath || !workspaceApi.completeSymbol) return void setStatusText("Completion unavailable");
    const selection = {
      line: selectionOverride?.line ?? editorSelection.line,
      column: selectionOverride?.column ?? editorSelection.column,
    };
    const currentContent = documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
    const replacePrefix = extractCompletionPrefix(currentContent, selection.line, selection.column);
    const query = trigger === "typing" ? replacePrefix : "";
    const results = await workspaceApi.completeSymbol({ path: activePath, line: selection.line, column: selection.column });
    setCompletionItems(results);
    setCompletionReplacePrefix(replacePrefix);
    setCompletionSelectedIndex(0);
    setQuickOpenQuery(query);
    setCompletionAutoFocus(trigger === "manual");
    setActiveOverlay("completion");
    setStatusText(results.length > 0 ? `Completion: ${results.length} items` : "Completion empty");
    if (trigger === "manual") {
      setEditorFocusToken((token) => token + 1);
      focusEditorSoon();
    } else {
      focusEditorSoon();
    }
  }
  async function openCompletionFromEditor() {
    await requestCompletion("manual");
  }
  function triggerTypingCompletion(selection: { line: number; column: number }) {
    clearTypingCompletionTimer();
    typingCompletionTimerRef.current = window.setTimeout(() => {
      void requestCompletion("typing", selection);
    }, 120);
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
  function insertCompletion(label: string) { completionRecencyCounterRef.current += 1; completionRecencyRef.current.set(label, completionRecencyCounterRef.current); setInsertTextTarget({ text: label, replaceBefore: completionReplacePrefix.length, nonce: Date.now() }); setCompletionItems([]); setCompletionReplacePrefix(""); setCompletionSelectedIndex(0); setActiveOverlay("none"); setEditorFocusToken((token) => token + 1); setStatusText(`Inserted completion: ${label}`); focusEditorSoon(); }
  function moveCompletionSelection(direction: 1 | -1, resultCount: number) {
    if (resultCount <= 0) {
      return;
    }

    setCompletionSelectedIndex((current) => {
      const normalized = Math.min(Math.max(current, 0), resultCount - 1);
      return (normalized + direction + resultCount) % resultCount;
    });
  }
  function moveSearchEverywhereSelection(direction: 1 | -1) {
    const resultCount = searchEverywhereResult.matches.length;
    if (resultCount <= 0) {
      return;
    }

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
  async function openSelectedSearchEverywhereResult() {
    const selected = searchEverywhereResult.matches[searchEverywhereSelectedIndex];
    if (!selected) {
      return;
    }

    await openSearchEverywhereResult(selected.path, selected.line, selected.column);
  }
  function toggleSearchEverywhereCaseSensitive() {
    setSearchEverywhereOptions((current) => ({
      ...current,
      caseSensitive: !current.caseSensitive,
    }));
  }
  function toggleSearchEverywhereWholeWord() {
    setSearchEverywhereOptions((current) => ({
      ...current,
      wholeWord: !current.wholeWord,
    }));
  }
  async function openUsageResult(item: UsageResult) {
    rememberCurrentLocation();
    await navigateToLocation({ path: item.path, line: item.line, column: item.column }, "Usage");
  }

  function submitGoToLine() {
    if (!activePath) return;
    const nextTarget = parseGoToLineQuery(quickOpenQuery);
    if (!nextTarget) {
      setStatusText("Go to Line requires line or line:column");
      return;
    }

    rememberCurrentLocation();
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
  useEffect(() => () => {
    clearTypingCompletionTimer();
    clearSettingsSaveResetTimer();
  }, []);
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
  function openGitTraceCommitDiff(patch: string) {
    setDiffFiles(parseUnifiedDiff(patch));
    setBottomVisible(true);
    setActiveBottomTool("git");
    setStatusText(patch ? "Commit diff loaded" : "No commit diff");
  }

  async function refreshEnvironmentReport() {
    setEnvironmentReport(await workspaceApi.inspectEnvironment());
  }
  async function openSettings() { setSettingsVisible(true); await refreshEnvironmentReport(); setStatusText("Settings"); }
  async function pickSettingsPath(field: "harmonySdkPath" | "semanticWorkerPath" | "nodePath"): Promise<string | null> {
    const title =
      field === "harmonySdkPath" ? "Select HarmonyOS / ArkTS SDK Path"
      : field === "semanticWorkerPath" ? "Select ArkTS LSP / Semantic Worker Path"
      : "Select Node Path";
    const selectedPath = await workspaceApi.pickPath?.({
      directory: field !== "nodePath",
      title,
    });
    return selectedPath ?? null;
  }

  async function applySettings(nextSettings: AppSettings) {
    setSettingsSaveState("saving");
    setStatusText("SDK settings applying...");
    clearSettingsSaveResetTimer();
    await workspaceApi.saveSettings(nextSettings);
    settingsRef.current.replace(nextSettings);
    setEditorAppearance({ ...nextSettings.editor });
    setRecentProjects([...nextSettings.recentProjects]);
    await refreshEnvironmentReport();
    await refreshSemanticState();
    setSettingsSaveState("saved");
    setStatusText("SDK settings applied");
    settingsSaveResetTimerRef.current = window.setTimeout(() => {
      setSettingsSaveState("idle");
      settingsSaveResetTimerRef.current = null;
    }, 1200);
  }
  const handleHydratedSettings = useCallback((settings: ReturnType<typeof createSettingsStore>["state"]["settings"]) => { setEditorAppearance({ ...settings.editor }); setRecentProjects([...settings.recentProjects]); }, []);
  useHydratedSettings({ workspaceApi, settingsRef, onHydrated: handleHydratedSettings });

  useEffect(() => {
    if (activeOverlay !== "searchEverywhere") {
      return;
    }

    const requestId = searchEverywhereRequestRef.current + 1;
    searchEverywhereRequestRef.current = requestId;

    if (!workspace) {
      setSearchEverywhereResult({
        query: { kind: "text", query: quickOpenQuery.trim() },
        matches: [],
      });
      setSearchEverywhereSelectedIndex(0);
      return;
    }

    void searchWorkspaceText({
      query: quickOpenQuery,
      rootPath: workspace.rootPath,
      paths: workspace.visibleFiles,
      options: searchEverywhereOptions,
      readFile: async (path) => {
        if (normalizePath(path) === normalizePath(activePath ?? "")) {
          return documentsRef.current.getDocument(path)?.currentContent ?? editorContent;
        }

        const document = documentsRef.current.getDocument(path);
        if (document) {
          return document.currentContent;
        }

        try {
          return await workspaceApi.openFile(path);
        } catch {
          return null;
        }
      },
      limit: 60,
    }).then((result) => {
      if (searchEverywhereRequestRef.current !== requestId) {
        return;
      }

      setSearchEverywhereResult(result);
      setSearchEverywhereSelectedIndex(0);
    });
  }, [activeOverlay, activePath, editorContent, quickOpenQuery, searchEverywhereOptions, workspace, workspaceApi]);

  useShellHotkeys({ onCommand(command: ShellCommand) {
    const handlers: Partial<Record<ShellCommand, () => void>> = {
      closeTransientUi, closeActiveFile, hideActiveToolWindow, toggleEditorOnly: enterEditorOnlyMode,
      navigateBack: () => void navigateBackFromHistory(),
      openQuickOpen: () => setOverlay("quickOpen"), openSearchEverywhere: () => setOverlay("searchEverywhere"), openRecentFiles: () => setOverlay("recentFiles"), openCommandPalette: () => setOverlay("commandPalette"), openCompletion: () => void openCompletionFromEditor(),
      showProject: () => showLeftTool("project"), showProblems: () => showBottomTool("problems"), showGit: () => showBottomTool("git"), showTerminal: () => showBottomTool("terminal"), goToDefinition: () => void goToDefinitionFromEditor(), findUsages: () => void findUsagesFromEditor(),
    };
    const handler = handlers[command];
    if (handler) return handler();
    void saveActiveDocument();
  } });

  const quickOpenResults = workspace ? rankPaths(workspace.visibleFiles, quickOpenQuery, 8) : [];
  const recentFileResults = filterRecentFileResults(tabsRef.current.state.recentFiles.map((path) => ({ path, title: getPathBasename(path) })), quickOpenQuery);
  const recentProjectResults = filterRecentProjectResults(recentProjects.map((path) => ({ path, name: getPathBasename(path) })), quickOpenQuery);
  const completionResults = [...completionItems]
    .filter((item) => {
      const query = quickOpenQuery.trim().toLowerCase();
      return !query || item.label.toLowerCase().includes(query) || item.detail.toLowerCase().includes(query);
    })
    .sort((left, right) => {
      const query = quickOpenQuery.trim().toLowerCase();
      const rank = (item: LanguageCompletionItem) => {
        const normalizedLabel = item.label.toLowerCase();
        const normalizedDetail = item.detail.toLowerCase();
        const hasPrefixMatch = query.length > 0 && normalizedLabel.startsWith(query);
        const labelContainsIndex = query.length > 0 ? normalizedLabel.indexOf(query) : -1;
        const detailContainsIndex = query.length > 0 ? normalizedDetail.indexOf(query) : -1;
        const recentPriority = -(completionRecencyRef.current.get(item.label) ?? 0);
        const kindPriority =
          item.kind === "keyword" ? 0
          : item.kind === "method" ? 1
          : item.kind === "function" ? 2
          : 3;
        const prefixPriority = hasPrefixMatch ? 0 : 1;
        const prefixDistancePriority = hasPrefixMatch ? normalizedLabel.length - query.length : Number.MAX_SAFE_INTEGER;
        const containsSourcePriority =
          hasPrefixMatch || query.length === 0 ? 0
          : labelContainsIndex >= 0 ? 0
          : detailContainsIndex >= 0 ? 1
          : 2;
        const containsPositionPriority =
          hasPrefixMatch || query.length === 0 ? 0
          : labelContainsIndex >= 0 ? labelContainsIndex
          : detailContainsIndex >= 0 ? detailContainsIndex
          : Number.MAX_SAFE_INTEGER;
        return [
          prefixPriority,
          prefixDistancePriority,
          containsSourcePriority,
          containsPositionPriority,
          recentPriority,
          kindPriority,
          normalizedLabel,
        ] as const;
      };
      const leftRank = rank(left);
      const rightRank = rank(right);
      return leftRank[0] - rightRank[0]
        || leftRank[1] - rightRank[1]
        || leftRank[2] - rightRank[2]
        || leftRank[3] - rightRank[3]
        || leftRank[4] - rightRank[4]
        || leftRank[5] - rightRank[5]
        || leftRank[6].localeCompare(rightRank[6]);
    });
  const selectedCompletion = completionResults[Math.min(completionSelectedIndex, Math.max(completionResults.length - 1, 0))] ?? null;

  useEffect(() => {
    setCompletionSelectedIndex((current) => {
      if (completionResults.length === 0) {
        return 0;
      }

      return Math.min(current, completionResults.length - 1);
    });
  }, [completionResults.length]);

  useEffect(() => {
    function handleCompletionAcceptKey(event: KeyboardEvent) {
      if (activeOverlay !== "completion" || completionAutoFocus || completionResults.length === 0 || !isEditorFocused()) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        moveCompletionSelection(event.key === "ArrowDown" ? 1 : -1, completionResults.length);
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setActiveOverlay("none");
        focusEditorSoon();
        return;
      }

      if (event.key !== "Tab" && event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      if (selectedCompletion) {
        insertCompletion(selectedCompletion.label);
      }
    }

    window.addEventListener("keydown", handleCompletionAcceptKey, true);
    return () => window.removeEventListener("keydown", handleCompletionAcceptKey, true);
  }, [activeOverlay, completionAutoFocus, completionResults, selectedCompletion]);

  const commandPaletteItems = buildAppShellCommandPaletteItems(quickOpenQuery, { openProject: () => void projectOpening.openProjectPicker(), openDemoWorkspace: () => void openDemoWorkspace(), openRecentProjects: () => setOverlay("recentProjects"), openGoToLine: () => setOverlay("goToLine"), goToDefinition: () => void goToDefinitionFromEditor(), findUsages: () => void findUsagesFromEditor(), openCompletion: () => void openCompletionFromEditor(), runLint: () => void runLint(), formatActiveDocument: () => void formatActiveDocument(), loadDiff: () => void loadDiff(), openSettings: () => void openSettings() });
  const overlayLabel = activeOverlay === "none" ? "Quick Open" : getOverlayLabel(activeOverlay);
  return (
    <div className="app-shell">
      <TopBar activeBottomTool={activeBottomTool} activeOverlay={activeOverlay} workspaceName={workspace?.rootName ?? null} settingsOpen={settingsVisible} onOpenProject={() => void projectOpening.openProjectPicker()} onOpenRecentProjects={() => setOverlay("recentProjects")} onOpenSearchEverywhere={() => setOverlay("searchEverywhere")} onOpenCommandPalette={() => setOverlay("commandPalette")} onRunLint={() => void runLint()} onFormat={() => void formatActiveDocument()} onLoadDiff={() => void loadDiff()} onOpenTerminal={() => showBottomTool("terminal")} onOpenSettings={() => void openSettings()} onToggleEditorOnly={enterEditorOnlyMode} />
      <div className="shell-grid">
        <ShellSidebar activePath={activePath} activeTool={activeLeftTool} filesVisible={filesVisible} workspace={workspace} filesPaneRef={filesPaneRef} onOpenFile={(path) => void openFile(path)} onSelectTool={showLeftTool} />
        <EditorSurface activePath={activePath} content={editorContent} openTabs={openTabs} appearance={editorAppearance} focusToken={editorFocusToken} insertTextTarget={insertTextTarget} selectionTarget={selectionTarget} workspaceName={workspace?.rootName ?? null} surfaceRef={editorSurfaceRef} onChange={handleEditorChange} onSelectionChange={setEditorSelection} onDefinitionTrigger={(selection) => void goToDefinitionFromEditor(selection, "modifierClick")} onDefinitionHoverChange={(state) => setDefinitionHoverActive(state.active)} onTypingCompletionTrigger={triggerTypingCompletion} blameLines={gitTraceState.blameLines} selectedBlameLine={gitTraceState.selectedLine} onGitTraceLineClick={(line) => { setEditorSelection({ line, column: 1 }); showBottomTool("gitTrace"); }} definitionHoverActive={definitionHoverActive} onSelectTab={setActiveDocument} />
      </div>
      <OverlaySurface activeOverlay={activeOverlay} label={overlayLabel}>
        <SearchOverlayContent activeOverlay={activeOverlay} commandPaletteItems={commandPaletteItems} completionResults={completionResults} completionSelectedIndex={completionSelectedIndex} quickOpenQuery={quickOpenQuery} quickOpenResults={quickOpenResults} recentFileResults={recentFileResults} recentProjectResults={recentProjectResults} searchEverywhereOptions={searchEverywhereOptions} searchEverywhereResult={searchEverywhereResult} searchEverywhereSelectedIndex={searchEverywhereSelectedIndex} onChangeQuery={handleOverlayQueryChange} onOpenFile={(path) => void openFile(path)} onOpenSearchEverywhereResult={(result) => void openSearchEverywhereResult(result.path, result.line, result.column)} onOpenProject={(path) => void projectOpening.requestProjectOpen(path)} onInsertCompletion={insertCompletion} onMoveCompletionSelection={(direction) => moveCompletionSelection(direction, completionResults.length)} onMoveSearchEverywhereSelection={moveSearchEverywhereSelection} onOpenSelectedSearchEverywhereResult={() => void openSelectedSearchEverywhereResult()} onSelectSearchEverywhereResult={setSearchEverywhereSelectedIndex} onToggleSearchEverywhereCaseSensitive={toggleSearchEverywhereCaseSensitive} onToggleSearchEverywhereWholeWord={toggleSearchEverywhereWholeWord} onAcceptSelectedCompletion={() => { if (selectedCompletion) insertCompletion(selectedCompletion.label); }} onSubmitGoToLine={submitGoToLine} onCloseOverlay={() => setActiveOverlay("none")} completionAutoFocus={completionAutoFocus} />
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

      <SettingsDialog
        environmentReport={environmentReport}
        open={settingsVisible}
        saveStateLabel={settingsSaveState === "saving" ? "Saving..." : settingsSaveState === "saved" ? "Saved" : "Ready"}
        settings={settingsRef.current.state.settings}
        onClose={() => setSettingsVisible(false)}
        onApply={applySettings}
        onPickPath={pickSettingsPath}
        onRefreshEnvironment={() => void refreshEnvironmentReport()}
      />
      <BottomToolWindow
        containerRef={bottomToolWindowRef} activeTool={activeBottomTool} onSelectTool={showBottomTool} visible={bottomVisible} problemsPanel={<ProblemsPanel problems={problems} />}
        terminalPanel={<TerminalToolWindowHost active={bottomVisible && activeBottomTool === "terminal"} onStatusChange={setStatusText} workspaceApi={workspaceApi} workspaceRootPath={workspace?.rootPath ?? null} />}
        gitPanel={<GitToolWindow files={diffFiles} onOpenFile={(path) => void openFile(path)} />}
        gitTracePanel={<GitTracePanel state={gitTraceState} onOpenInEditor={focusEditorSoon} onOpenCommitDiff={openGitTraceCommitDiff} />}
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
