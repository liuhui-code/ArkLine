import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BottomToolWindow } from "@/components/layout/BottomToolWindow";
import { CompletionPopup } from "@/components/layout/CompletionPopup";
import { normalizeCompletionItems, rankCompletionItems, type CompletionPresentation } from "@/components/layout/completion-model";
import { EditorSurface } from "@/components/layout/EditorSurface";
import { GitBlameCard } from "@/components/layout/GitBlameCard";
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
import type { GitBlameAttribution } from "@/features/git/git-trace-model";
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
import type { EditorCaretRect } from "@/editor/editor-events";

type AppShellProps = { workspaceApi?: WorkspaceApi };
type NavigationLocation = { path: string; line: number; column: number };
const COMPLETION_POPUP_WIDTH = 460;
const COMPLETION_POPUP_HEIGHT = 340;
const COMPLETION_POPUP_MARGIN = 12;
const COMPLETION_POPUP_GAP = 4;
const COMPLETION_PAGE_STEP = 6;
const COMPLETION_POPUP_FALLBACK_POSITION = { top: 96, left: 280 };

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function constrainCompletionPopupPosition(top: number, left: number) {
  if (typeof window === "undefined") {
    return { top, left };
  }

  const maxLeft = window.innerWidth - COMPLETION_POPUP_WIDTH - COMPLETION_POPUP_MARGIN;
  return {
    top: Math.max(COMPLETION_POPUP_MARGIN, top),
    left: clampNumber(left, COMPLETION_POPUP_MARGIN, maxLeft),
  };
}

function getCompletionPopupPosition(anchor: EditorCaretRect | null) {
  if (!anchor?.measured) {
    return constrainCompletionPopupPosition(COMPLETION_POPUP_FALLBACK_POSITION.top, COMPLETION_POPUP_FALLBACK_POSITION.left);
  }

  if (typeof window === "undefined") {
    return { top: anchor.bottom + COMPLETION_POPUP_GAP, left: anchor.left };
  }

  const belowTop = anchor.bottom + COMPLETION_POPUP_GAP;
  const hasSpaceBelow = belowTop + COMPLETION_POPUP_HEIGHT + COMPLETION_POPUP_MARGIN <= window.innerHeight;
  const preferredTop = hasSpaceBelow ? belowTop : anchor.top - COMPLETION_POPUP_HEIGHT - COMPLETION_POPUP_GAP;

  return constrainCompletionPopupPosition(preferredTop, anchor.left);
}

export function AppShell({ workspaceApi = defaultWorkspaceApi }: AppShellProps) {
  const canUseNativeProjectPicker = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const [filesVisible, setFilesVisible] = useState(true);
  const [bottomContentVisible, setBottomContentVisible] = useState(true);
  const [bottomToolHeight, setBottomToolHeight] = useState(280);
  const [bottomLayoutToken, setBottomLayoutToken] = useState(0);
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
  const [settingsApplyState, setSettingsApplyState] = useState<"idle" | "applying" | "applied" | "failed">("idle");
  const [environmentReport, setEnvironmentReport] = useState<EnvironmentReport | null>(null);
  const [editorAppearance, setEditorAppearance] = useState(createSettingsStore().state.settings.editor);
  const [editorFocusToken, setEditorFocusToken] = useState(0);
  const [selectionTarget, setSelectionTarget] = useState<{ line: number; column: number; nonce: number } | null>(null);
  const [insertTextTarget, setInsertTextTarget] = useState<{ text: string; replaceBefore?: number; nonce: number } | null>(null);
  const [editorSelection, setEditorSelection] = useState({ line: 1, column: 1 });
  const [completionAnchor, setCompletionAnchor] = useState<EditorCaretRect | null>(null);
  const [completionItems, setCompletionItems] = useState<LanguageCompletionItem[]>([]);
  const [completionReplacePrefix, setCompletionReplacePrefix] = useState("");
  const [completionSelectedIndex, setCompletionSelectedIndex] = useState(0);
  const [completionTrigger, setCompletionTrigger] = useState<"manual" | "typing">("typing");
  const [completionStatus, setCompletionStatus] = useState<"ready" | "empty" | "error">("empty");
  const [completionMessage, setCompletionMessage] = useState<string | undefined>();
  const [usageSearch, setUsageSearch] = useState<UsageSearchState>(idleUsageSearchState());
  const [definitionDebugText, setDefinitionDebugText] = useState("");
  const [statusText, setStatusText] = useState("Mode: shell bootstrap");
  const [definitionHoverActive, setDefinitionHoverActive] = useState(false);
  const [gitBlameVisible, setGitBlameVisible] = useState(false);
  const [gitBlameMenuOpen, setGitBlameMenuOpen] = useState(false);
  const [gitBlameRefreshToken, setGitBlameRefreshToken] = useState(0);
  const [selectedBlameAttribution, setSelectedBlameAttribution] = useState<GitBlameAttribution | null>(null);
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
  const completionRequestRef = useRef(0);
  const searchEverywhereRequestRef = useRef(0);
  const settingsSaveResetTimerRef = useRef<number | null>(null);
  const typingCompletionTimerRef = useRef<number | null>(null);
  const { semanticState, refreshSemanticState } = useSemanticState(workspaceApi);
  const settingsApplying = settingsApplyState === "applying";
  const activeDocument = activePath ? documentsRef.current.getDocument(activePath) : undefined;
  const { gitTraceState } = useGitTrace({
    activeLine: editorSelection.line,
    activePath,
    activeText: activeDocument?.currentContent ?? editorContent,
    baseText: activeDocument?.originalContent ?? editorContent,
    activeTool: activeBottomTool,
    refreshToken: gitBlameRefreshToken,
    workspaceApi,
  });
  const currentLineBlame = formatCurrentLineBlame(
    gitTraceState.blameAttributions.find((line) => line.bufferLine === editorSelection.line) ?? null,
  );
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
  function maxBottomToolHeight() {
    return Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.7);
  }
  function clampBottomToolHeight(height: number) {
    return Math.max(160, Math.min(maxBottomToolHeight(), Math.round(height)));
  }
  function resizeBottomToolWindow(height: number) {
    setBottomToolHeight(clampBottomToolHeight(height));
    setBottomLayoutToken((token) => token + 1);
  }
  function toggleBottomToolMaxHeight() {
    const maxHeight = maxBottomToolHeight();
    const nextHeight = Math.abs(bottomToolHeight - maxHeight) <= 2 ? 280 : maxHeight;
    resizeBottomToolWindow(nextHeight);
  }
  function setOverlay(overlay: Exclude<OverlayKey, "none">) {
    setActiveOverlay(overlay);
    setQuickOpenQuery("");
    setSearchEverywhereSelectedIndex(0);
    setStatusText(getOverlayLabel(overlay));
  }
  function handleOverlayQueryChange(value: string) {
    setQuickOpenQuery(value);
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
    showBottomTool(tool === "git" ? "git" : "problems");
  }
  function showBottomTool(tool: BottomToolKey) {
    setBottomContentVisible(true);
    setBottomLayoutToken((token) => token + 1);
    setActiveBottomTool(tool);
    setStatusText(
      tool === "terminal" ? "Terminal"
      : tool === "git" ? "Git"
      : tool === "gitTrace" ? "Git Trace"
      : tool === "usages" ? "Usages"
      : "Problems",
    );
  }
  function toggleBottomTool(tool: BottomToolKey) {
    if (bottomContentVisible && activeBottomTool === tool) {
      hideBottomToolWindow();
      return;
    }
    showBottomTool(tool);
  }
  function hideBottomToolWindow() {
    setBottomContentVisible(false);
    setStatusText("Editor");
    focusEditorSoon();
  }
  function openUsagesToolWindow() {
    showBottomTool("usages");
  }
  function toggleGitBlame() {
    setGitBlameVisible((visible) => !visible);
    setSelectedBlameAttribution(null);
    setGitBlameMenuOpen(false);
  }
  function toggleGitBlameMenu() {
    setGitBlameMenuOpen((open) => !open);
  }
  function refreshGitBlame() {
    if (!activePath) {
      setStatusText("Git Blame unavailable: no active file");
      setGitBlameMenuOpen(false);
      return;
    }
    setGitBlameRefreshToken((token) => token + 1);
    setGitBlameMenuOpen(false);
    setStatusText("Blame refreshed");
  }
  function closeGitBlame() {
    setGitBlameVisible(false);
    setSelectedBlameAttribution(null);
    setGitBlameMenuOpen(false);
  }
  function showCurrentLineBlame() {
    const attribution = gitTraceState.blameAttributions.find((item) => item.bufferLine === editorSelection.line) ?? null;
    if (!attribution) {
      setStatusText("Git Blame unavailable for current line");
      setGitBlameMenuOpen(false);
      return;
    }
    setSelectedBlameAttribution(attribution);
    setGitBlameMenuOpen(false);
  }
  function selectGitBlameLine(line: number) {
    const attribution = gitTraceState.blameAttributions.find((item) => item.bufferLine === line) ?? null;
    setEditorSelection({ line, column: 1 });
    setSelectedBlameAttribution(attribution);
  }
  function showSelectedBlameDiff() {
    if (selectedBlameAttribution?.commit) {
      showBottomTool("gitTrace");
    } else {
      showBottomTool("git");
    }
  }
  function showSelectedBlameCommit() {
    if (!selectedBlameAttribution?.commit) {
      return;
    }
    showBottomTool("gitTrace");
  }
  async function showSelectedLocalDiff() {
    await loadDiff();
    setSelectedBlameAttribution(null);
  }
  function copySelectedBlameHash() {
    if (!selectedBlameAttribution?.commit) {
      return;
    }
    void navigator.clipboard?.writeText(selectedBlameAttribution.commit);
    setStatusText(`Copied commit ${selectedBlameAttribution.shortCommit ?? selectedBlameAttribution.commit.slice(0, 7)}`);
  }

  function closeTransientUi() {
    if (gitBlameMenuOpen) {
      setGitBlameMenuOpen(false);
      focusEditor();
      return true;
    }
    if (selectedBlameAttribution) {
      setSelectedBlameAttribution(null);
      focusEditor();
      return true;
    }
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
      [bottomContentVisible, bottomToolWindowRef.current, hideBottomToolWindow],
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
    setBottomContentVisible(false);
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
    setCompletionAnchor(null);
    setUsageSearch(idleUsageSearchState());
    setEditorSelection({ line: 1, column: 1 });
    setInsertTextTarget(null);
    setSelectionTarget(null);
    setBottomContentVisible(true);
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
    setCompletionAnchor(null);
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
    if (settingsApplying) {
      if (source === "modifierClick") {
        setDefinitionDebug("Ctrl+Click is paused while SDK settings are applying.");
      }
      setStatusText("SDK settings are still applying");
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
    if (trigger === "manual") {
      clearTypingCompletionTimer();
    }
    if (settingsApplying) {
      setStatusText("SDK settings are still applying");
      return;
    }
    if (!activePath || !workspaceApi.completeSymbol) return void setStatusText("Completion unavailable");
    const requestId = completionRequestRef.current + 1;
    completionRequestRef.current = requestId;
    const selection = {
      line: selectionOverride?.line ?? editorSelection.line,
      column: selectionOverride?.column ?? editorSelection.column,
    };
    const path = activePath;
    const currentContent = documentsRef.current.getDocument(activePath)?.currentContent ?? editorContent;
    const replacePrefix = extractCompletionPrefix(currentContent, selection.line, selection.column);
    const query = trigger === "typing" ? replacePrefix : "";
    let results: LanguageCompletionItem[];
    try {
      results = await workspaceApi.completeSymbol({ path, line: selection.line, column: selection.column });
    } catch (error) {
      if (completionRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setCompletionItems([]);
      setCompletionReplacePrefix(replacePrefix);
      setCompletionSelectedIndex(0);
      setQuickOpenQuery(query);
      setCompletionTrigger(trigger);
      setCompletionStatus("error");
      setCompletionMessage(`Completion failed: ${message}`);
      if (trigger === "manual") {
        setActiveOverlay("completion");
        setEditorFocusToken((token) => token + 1);
        focusEditorSoon();
      } else {
        setActiveOverlay((current) => (current === "completion" ? "none" : current));
        focusEditorSoon();
      }
      setStatusText(`Completion failed: ${message}`);
      return;
    }
    if (completionRequestRef.current !== requestId) {
      return;
    }

    setCompletionItems(results);
    setCompletionReplacePrefix(replacePrefix);
    setCompletionSelectedIndex(0);
    setQuickOpenQuery(query);
    setCompletionTrigger(trigger);
    setCompletionStatus(results.length > 0 ? "ready" : "empty");
    setCompletionMessage(results.length > 0 ? undefined : "No completions");
    if (trigger === "manual" || results.length > 0) {
      setActiveOverlay("completion");
    } else {
      setActiveOverlay((current) => (current === "completion" ? "none" : current));
    }
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
    if (settingsApplying) {
      setStatusText("SDK settings are still applying");
      return;
    }
    typingCompletionTimerRef.current = window.setTimeout(() => {
      void requestCompletion("typing", selection);
    }, 120);
  }
  async function findUsagesFromEditor() {
    if (settingsApplying) {
      setStatusText("SDK settings are still applying");
      return;
    }
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
  function insertCompletionItem(item: CompletionPresentation) {
    const text = completionInsertTextToPlainText(item.insertText);
    const replaceBefore = completionReplacementLength(item, editorSelection, documentsRef.current.getDocument(activePath ?? "")?.currentContent ?? editorContent, completionReplacePrefix);

    completionRequestRef.current += 1;
    completionRecencyCounterRef.current += 1;
    completionRecencyRef.current.set(item.label, completionRecencyCounterRef.current);
    setInsertTextTarget({ text, replaceBefore, nonce: Date.now() });
    setCompletionItems([]);
    setCompletionReplacePrefix("");
    setCompletionSelectedIndex(0);
    setCompletionStatus("empty");
    setCompletionMessage(undefined);
    setActiveOverlay("none");
    setEditorFocusToken((token) => token + 1);
    setStatusText(`Inserted completion: ${item.label}`);
    focusEditorSoon();
  }
  function moveCompletionSelection(direction: 1 | -1, resultCount: number) {
    if (resultCount <= 0) {
      return;
    }

    setCompletionSelectedIndex((current) => {
      const normalized = Math.min(Math.max(current, 0), resultCount - 1);
      return (normalized + direction + resultCount) % resultCount;
    });
  }
  function moveCompletionSelectionByPage(direction: 1 | -1, resultCount: number) {
    if (resultCount <= 0) {
      return;
    }

    setCompletionSelectedIndex((current) => {
      const normalized = Math.min(Math.max(current, 0), resultCount - 1);
      return clampNumber(normalized + direction * COMPLETION_PAGE_STEP, 0, resultCount - 1);
    });
  }
  function setCompletionSelectionBoundary(position: "first" | "last", resultCount: number) {
    if (resultCount <= 0) {
      return;
    }

    setCompletionSelectedIndex(position === "first" ? 0 : resultCount - 1);
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
    showBottomTool("problems");
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
    showBottomTool("problems");
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
    setGitBlameRefreshToken((token) => token + 1);
    await refreshProblems(activePath, content);
    setStatusText(`Saved ${getPathBasename(activePath)}`);
  }

  async function loadDiff() {
    const diffText = await workspaceApi.loadDiff(workspace?.rootPath ?? null);
    setDiffFiles(parseUnifiedDiff(diffText));
    showBottomTool("git");
    setStatusText(diffText ? "Diff loaded" : "No diff");
  }
  function openGitTraceCommitDiff(patch: string) {
    setDiffFiles(parseUnifiedDiff(patch));
    showBottomTool("git");
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
      : "Select Node Directory";
    const selectedPath = await workspaceApi.pickPath?.({
      directory: field !== "semanticWorkerPath",
      title,
    });
    return selectedPath ?? null;
  }

  async function applySettings(nextSettings: AppSettings) {
    setSettingsApplyState("applying");
    setSettingsSaveState("saving");
    setStatusText("SDK settings applying...");
    clearSettingsSaveResetTimer();
    clearTypingCompletionTimer();
    try {
      await workspaceApi.saveSettings(nextSettings);
    } catch (error) {
      setSettingsApplyState("failed");
      setSettingsSaveState("idle");
      setStatusText(`SDK settings apply failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    settingsRef.current.replace(nextSettings);
    setEditorAppearance({ ...nextSettings.editor });
    setRecentProjects([...nextSettings.recentProjects]);

    try {
      await refreshEnvironmentReport();
      await refreshSemanticState({ throwOnError: true });
    } catch (error) {
      setSettingsApplyState("failed");
      setSettingsSaveState("idle");
      setStatusText(`SDK settings apply failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }

    setSettingsApplyState("applied");
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

  const shellHotkeyContext = useMemo(() => ({
    completionOpen: activeOverlay === "completion",
    overlayOpen: activeOverlay !== "none" && activeOverlay !== "completion",
    settingsOpen: settingsVisible,
    settingsApplying,
  }), [activeOverlay, settingsApplying, settingsVisible]);

  useShellHotkeys({ context: shellHotkeyContext, onCommand(command: ShellCommand) {
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
  const completionPresentationContext = useMemo(() => {
    const acceptedLabels = [...completionRecencyRef.current.entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([label]) => label);
    return {
      prefix: quickOpenQuery.trim() || completionReplacePrefix,
      lineTextBeforeCursor: getLineTextBeforeCursor(
        documentsRef.current.getDocument(activePath ?? "")?.currentContent ?? editorContent,
        editorSelection.line,
        editorSelection.column,
      ),
      trigger: completionTrigger,
      acceptedLabels,
    } as const;
  }, [activePath, completionReplacePrefix, completionTrigger, editorContent, editorSelection.column, editorSelection.line, quickOpenQuery]);
  const completionPresentationResults = rankCompletionItems(
    normalizeCompletionItems(completionItems, completionPresentationContext).filter((item) => {
      const query = quickOpenQuery.trim().toLowerCase();
      return !query
        || item.label.toLowerCase().includes(query)
        || item.filterText.toLowerCase().includes(query)
        || item.detail.toLowerCase().includes(query);
    }),
    completionPresentationContext,
  );
  const selectedCompletionPresentation = completionPresentationResults[Math.min(completionSelectedIndex, Math.max(completionPresentationResults.length - 1, 0))] ?? null;
  const completionPopupVisible = activeOverlay === "completion" && (completionPresentationResults.length > 0 || completionTrigger === "manual" || completionStatus === "error");
  const overlayVisible = activeOverlay !== "none" && activeOverlay !== "completion";
  const completionPopupPosition = getCompletionPopupPosition(completionAnchor);

  useEffect(() => {
    setCompletionSelectedIndex((current) => {
      const resultCount = completionPresentationResults.length;
      if (resultCount === 0) {
        return 0;
      }

      return Math.min(current, resultCount - 1);
    });
  }, [completionPresentationResults.length]);

  useEffect(() => {
    function handleCompletionAcceptKey(event: KeyboardEvent) {
      if (activeOverlay !== "completion" || !isEditorFocused()) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.code === "Space") {
        event.preventDefault();
        event.stopPropagation();
        void openCompletionFromEditor();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setActiveOverlay("none");
        focusEditorSoon();
        return;
      }

      if (completionPresentationResults.length === 0) {
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        moveCompletionSelection(event.key === "ArrowDown" ? 1 : -1, completionPresentationResults.length);
        return;
      }

      if (event.key === "PageDown" || event.key === "PageUp") {
        event.preventDefault();
        event.stopPropagation();
        moveCompletionSelectionByPage(event.key === "PageDown" ? 1 : -1, completionPresentationResults.length);
        return;
      }

      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        event.stopPropagation();
        setCompletionSelectionBoundary(event.key === "Home" ? "first" : "last", completionPresentationResults.length);
        return;
      }

      if (event.key !== "Tab" && event.key !== "Enter") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (selectedCompletionPresentation) {
        insertCompletionItem(selectedCompletionPresentation);
      }
    }

    window.addEventListener("keydown", handleCompletionAcceptKey, true);
    return () => window.removeEventListener("keydown", handleCompletionAcceptKey, true);
  }, [activeOverlay, completionPresentationResults.length, selectedCompletionPresentation]);

  const commandPaletteItems = buildAppShellCommandPaletteItems(quickOpenQuery, {
    openProject: () => void projectOpening.openProjectPicker(),
    openDemoWorkspace: () => void openDemoWorkspace(),
    openRecentProjects: () => setOverlay("recentProjects"),
    openGoToLine: () => setOverlay("goToLine"),
    goToDefinition: () => void goToDefinitionFromEditor(),
    findUsages: () => void findUsagesFromEditor(),
    openCompletion: () => void openCompletionFromEditor(),
    runLint: () => void runLint(),
    formatActiveDocument: () => void formatActiveDocument(),
    loadDiff: () => void loadDiff(),
    openSettings: () => void openSettings(),
    toggleGitBlame,
    refreshGitBlame,
    showCurrentLineBlame,
    closeGitBlame,
  });
  const overlayLabel = activeOverlay === "none" ? "Quick Open" : getOverlayLabel(activeOverlay);
  return (
    <div className="app-shell" data-bottom-layout-token={bottomLayoutToken}>
      <TopBar activeBottomTool={activeBottomTool} activeOverlay={activeOverlay} workspaceName={workspace?.rootName ?? null} settingsOpen={settingsVisible} onOpenProject={() => void projectOpening.openProjectPicker()} onOpenRecentProjects={() => setOverlay("recentProjects")} onOpenSearchEverywhere={() => setOverlay("searchEverywhere")} onOpenCommandPalette={() => setOverlay("commandPalette")} onRunLint={() => void runLint()} onFormat={() => void formatActiveDocument()} onLoadDiff={() => void loadDiff()} onOpenTerminal={() => showBottomTool("terminal")} onOpenSettings={() => void openSettings()} onToggleEditorOnly={enterEditorOnlyMode} />
      <div className="shell-grid">
        <ShellSidebar activePath={activePath} activeTool={activeLeftTool} filesVisible={filesVisible} workspace={workspace} filesPaneRef={filesPaneRef} onOpenFile={(path) => void openFile(path)} onSelectTool={showLeftTool} />
        <EditorSurface activePath={activePath} content={editorContent} openTabs={openTabs} appearance={editorAppearance} focusToken={editorFocusToken} insertTextTarget={insertTextTarget} selectionTarget={selectionTarget} workspaceName={workspace?.rootName ?? null} surfaceRef={editorSurfaceRef} onChange={handleEditorChange} onSelectionChange={setEditorSelection} onCaretRectChange={setCompletionAnchor} onDefinitionTrigger={(selection) => void goToDefinitionFromEditor(selection, "modifierClick")} onDefinitionHoverChange={(state) => setDefinitionHoverActive(state.active)} onTypingCompletionTrigger={triggerTypingCompletion} blameAttributions={gitTraceState.blameAttributions} gitBlameVisible={gitBlameVisible} selectedBlameLine={selectedBlameAttribution?.bufferLine ?? gitTraceState.selectedLine} onGitTraceLineClick={selectGitBlameLine} definitionHoverActive={definitionHoverActive} onSelectTab={setActiveDocument} />
      </div>
      {selectedBlameAttribution ? (
        <GitBlameCard
          attribution={selectedBlameAttribution}
          onClose={() => setSelectedBlameAttribution(null)}
          onShowCommit={showSelectedBlameCommit}
          onShowDiff={showSelectedBlameDiff}
          onShowLocalDiff={() => void showSelectedLocalDiff()}
          onCopyHash={copySelectedBlameHash}
        />
      ) : null}
      {completionPopupVisible ? (
        <CompletionPopup
          items={completionPresentationResults}
          selectedIndex={completionSelectedIndex}
          position={completionPopupPosition}
          anchor={completionAnchor}
          status={completionPresentationResults.length > 0 ? "ready" : completionStatus}
          message={completionMessage}
          detailsVisible={Boolean(selectedCompletionPresentation?.documentation || selectedCompletionPresentation?.definitionTarget)}
          onAccept={insertCompletionItem}
          onSelect={setCompletionSelectedIndex}
        />
      ) : null}
      {overlayVisible ? (
        <OverlaySurface activeOverlay={activeOverlay} label={overlayLabel} onClose={() => setActiveOverlay("none")}>
          <SearchOverlayContent activeOverlay={activeOverlay} commandPaletteItems={commandPaletteItems} quickOpenQuery={quickOpenQuery} quickOpenResults={quickOpenResults} recentFileResults={recentFileResults} recentProjectResults={recentProjectResults} searchEverywhereOptions={searchEverywhereOptions} searchEverywhereResult={searchEverywhereResult} searchEverywhereSelectedIndex={searchEverywhereSelectedIndex} onChangeQuery={handleOverlayQueryChange} onOpenFile={(path) => void openFile(path)} onOpenSearchEverywhereResult={(result) => void openSearchEverywhereResult(result.path, result.line, result.column)} onOpenProject={(path) => void projectOpening.requestProjectOpen(path)} onMoveSearchEverywhereSelection={moveSearchEverywhereSelection} onOpenSelectedSearchEverywhereResult={() => void openSelectedSearchEverywhereResult()} onSelectSearchEverywhereResult={setSearchEverywhereSelectedIndex} onToggleSearchEverywhereCaseSensitive={toggleSearchEverywhereCaseSensitive} onToggleSearchEverywhereWholeWord={toggleSearchEverywhereWholeWord} onSubmitGoToLine={submitGoToLine} onCloseOverlay={() => setActiveOverlay("none")} />
        </OverlaySurface>
      ) : null}

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
        containerRef={bottomToolWindowRef} activeTool={activeBottomTool} contentVisible={bottomContentVisible} height={bottomToolHeight} maxHeight={maxBottomToolHeight()} onResizeHeight={resizeBottomToolWindow} onToggleMaxHeight={toggleBottomToolMaxHeight} onToggleTool={toggleBottomTool} onClose={hideBottomToolWindow} problemsPanel={<ProblemsPanel problems={problems} />}
        terminalPanel={<TerminalToolWindowHost active={bottomContentVisible && activeBottomTool === "terminal"} layoutToken={bottomLayoutToken} onStatusChange={setStatusText} workspaceApi={workspaceApi} workspaceRootPath={workspace?.rootPath ?? null} />}
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
      <ShellStatusBar activeBottomTool={activeBottomTool} activePath={activePath} semanticState={semanticState} statusText={statusText} workspaceName={workspace?.rootName ?? null} terminalRunning={false} currentLineBlame={currentLineBlame} gitBlameVisible={gitBlameVisible} gitBlameMenuOpen={gitBlameMenuOpen} onToggleGitBlameMenu={toggleGitBlameMenu} onToggleGitBlame={toggleGitBlame} onRefreshGitBlame={refreshGitBlame} onShowCurrentLineBlame={showCurrentLineBlame} onCloseGitBlame={closeGitBlame} />
    </div>
  );
}

function formatCurrentLineBlame(attribution: GitBlameAttribution | null) {
  if (!attribution) {
    return null;
  }

  if (attribution.status === "added") {
    return "Blame: Uncommitted";
  }

  if (attribution.status === "modified") {
    return `Blame: Modified, originally ${attribution.originalAuthor ?? attribution.author ?? "Unknown"}`;
  }

  if (attribution.status === "committed") {
    return `Blame: ${attribution.author ?? "Unknown"}${attribution.relativeTime ? `, ${attribution.relativeTime}` : ""}`;
  }

  return null;
}

function getLineTextBeforeCursor(content: string, line: number, column: number) {
  const lines = content.split(/\r?\n/);
  const lineText = lines[Math.max(0, line - 1)] ?? "";
  return lineText.slice(0, Math.max(0, column - 1));
}

function completionInsertTextToPlainText(insertText: string) {
  return insertText
    .replace(/\$\{\d+:([^}]*)\}/g, "$1")
    .replace(/\$\d+/g, "");
}

function completionReplacementLength(
  item: CompletionPresentation,
  selection: { line: number; column: number },
  content: string,
  fallbackPrefix: string,
) {
  const range = item.replacementRange;
  if (
    range
    && range.startLine === selection.line
    && range.endLine === selection.line
    && range.endColumn === selection.column
    && range.startColumn >= 1
    && range.startColumn <= range.endColumn
  ) {
    return Math.max(0, selection.column - range.startColumn);
  }

  return extractCompletionPrefix(content, selection.line, selection.column).length || fallbackPrefix.length;
}
