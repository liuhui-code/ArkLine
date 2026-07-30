import { useState, useSyncExternalStore } from "react";
import type { GitToolView } from "@/components/layout/GitToolWindow";
import { useGitTrace } from "@/components/layout/use-git-trace";
import { parseUnifiedDiff, type DiffFile } from "@/features/diff/unified-diff";
import type { GitBlameAttribution, GitBlameLine } from "@/features/git/git-trace-model";
import type { GitDiffActionContext, GitFileComparison } from "@/features/git/git-source-control-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { EditorSelectionRuntime } from "@/features/editor/editor-selection-runtime";

const subscribeDisabled = () => () => {};

export type UseGitAndDiffControllerOptions = {
  workspaceRootPath: string | null;
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  editorSelectionRuntime: EditorSelectionRuntime;
  getActiveText: () => string;
  getBaseText: () => string;
  gitToolVisible: boolean;
  showGit: () => void;
  setEditorSelection: (selection: { line: number; column: number }) => void;
  focusEditor: () => void;
  onStatusChange: (message: string) => void;
};

export function useGitAndDiffController({
  workspaceRootPath,
  workspaceApi,
  activePath,
  editorSelectionRuntime,
  getActiveText,
  getBaseText,
  gitToolVisible,
  showGit,
  setEditorSelection,
  focusEditor,
  onStatusChange,
}: UseGitAndDiffControllerOptions) {
  const [diffFiles, setDiffFiles] = useState<DiffFile[]>([]);
  const [diffActionContext, setDiffActionContext] = useState<GitDiffActionContext | null>(null);
  const [diffComparison, setDiffComparison] = useState<GitFileComparison | null>(null);
  const [gitToolView, setGitToolView] = useState<GitToolView>("changes");
  const [gitBlameVisible, setGitBlameVisible] = useState(false);
  const [gitBlameMenuOpen, setGitBlameMenuOpen] = useState(false);
  const [gitBlameRefreshToken, setGitBlameRefreshToken] = useState(0);
  const [selectedBlameAttribution, setSelectedBlameAttribution] = useState<GitBlameAttribution | null>(null);
  const traceVisible = gitToolVisible && gitToolView === "trace";
  const gitTraceEnabled = gitBlameVisible || traceVisible || gitBlameMenuOpen || selectedBlameAttribution !== null;
  const activeLine = useSyncExternalStore(
    gitTraceEnabled ? editorSelectionRuntime.subscribe : subscribeDisabled,
    () => editorSelectionRuntime.getSnapshot().line,
    () => editorSelectionRuntime.getSnapshot().line,
  );
  const { gitTraceState } = useGitTrace({
    activeLine,
    activePath,
    activeText: gitTraceEnabled ? getActiveText() : "",
    baseText: gitTraceEnabled ? getBaseText() : "",
    enabled: Boolean(activePath),
    mappingEnabled: gitTraceEnabled,
    traceVisible,
    refreshToken: gitBlameRefreshToken,
    workspaceApi,
  });
  const mappedCurrentLine = gitTraceState.blameAttributions.find((line) => line.bufferLine === activeLine) ?? null;
  const currentLineAttribution = gitTraceEnabled
    ? mappedCurrentLine
    : attributionFromBlameLine(gitTraceState.blameLines.find((line) => line.line === activeLine)) ?? mappedCurrentLine;
  const currentLineBlame = formatCurrentLineBlame(currentLineAttribution);

  function openGitTraceView() {
    setGitToolView("trace");
    showGit();
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
      onStatusChange("Git Blame unavailable: no active file");
      setGitBlameMenuOpen(false);
      return;
    }
    setGitBlameRefreshToken((token) => token + 1);
    setGitBlameMenuOpen(false);
    onStatusChange("Blame refreshed");
  }

  function closeGitBlame() {
    setGitBlameVisible(false);
    setSelectedBlameAttribution(null);
    setGitBlameMenuOpen(false);
  }

  function showCurrentLineBlame() {
    const attribution = currentLineAttribution;
    if (!attribution) {
      onStatusChange("Git Blame unavailable for current line");
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
      openGitTraceView();
    } else {
      setGitToolView("changes");
      showGit();
    }
  }

  function showSelectedBlameCommit() {
    if (!selectedBlameAttribution?.commit) {
      return;
    }
    openGitTraceView();
  }

  async function loadDiff() {
    const diffText = await workspaceApi.loadDiff(workspaceRootPath);
    setDiffFiles(parseUnifiedDiff(diffText));
    setDiffActionContext(null);
    setDiffComparison(null);
    setGitToolView("changes");
    showGit();
    onStatusChange(diffText ? "Diff loaded" : "No diff");
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
    onStatusChange(`Copied commit ${selectedBlameAttribution.shortCommit ?? selectedBlameAttribution.commit.slice(0, 7)}`);
  }

  function openGitTraceCommitDiff(patch: string, context?: GitDiffActionContext, comparison: GitFileComparison | null = null) {
    setDiffFiles(parseUnifiedDiff(patch));
    setDiffActionContext(context ?? null);
    setDiffComparison(comparison);
    setGitToolView("changes");
    showGit();
    onStatusChange(patch ? "Commit diff loaded" : "No commit diff");
  }

  function closeTransientGitUi() {
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
    return false;
  }

  function resetDiff() {
    setDiffFiles([]);
    setDiffActionContext(null);
    setDiffComparison(null);
  }

  return {
    diffFiles,
    diffActionContext,
    diffComparison,
    gitToolView,
    setGitToolView,
    gitTraceState,
    currentLineBlame,
    gitBlameVisible,
    gitBlameMenuOpen,
    selectedBlameAttribution,
    setSelectedBlameAttribution,
    toggleGitBlame,
    toggleGitBlameMenu,
    refreshGitBlame,
    closeGitBlame,
    showCurrentLineBlame,
    selectGitBlameLine,
    showSelectedBlameDiff,
    showSelectedBlameCommit,
    showSelectedLocalDiff,
    copySelectedBlameHash,
    loadDiff,
    openGitTraceCommitDiff,
    closeTransientGitUi,
    resetDiff,
  };
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

function attributionFromBlameLine(line: GitBlameLine | undefined): GitBlameAttribution | null {
  if (!line) return null;
  return {
    bufferLine: line.line,
    sourceLine: line.sourceLine,
    status: "committed",
    commit: line.commit,
    shortCommit: line.commit.slice(0, 7),
    author: line.author,
    authoredAt: line.authoredAt,
    relativeTime: line.relativeTime,
    summary: line.summary,
  };
}
