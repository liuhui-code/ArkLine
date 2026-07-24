import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { collectCompletionCandidateResult } from "@/components/layout/completion-candidate-provider";
import { createCompletionHistoryStore } from "@/components/layout/completion-history-store";
import { buildCompletionInsertTarget, normalizeCompletionItems, rankCompletionItems, type CompletionPresentation } from "@/components/layout/completion-model";
import { COMPLETION_PAGE_STEP } from "@/components/layout/app-shell-constants";
import { clampNumber } from "@/components/layout/app-shell-model";
import { extractCompletionPrefix, getLineTextBeforeCursor } from "@/components/layout/app-shell-helpers";
import { buildLanguageQuerySnapshot } from "@/components/layout/language-query-request-model";
import { decideLanguageQuerySync, formatLanguageQuerySyncBlockedMessage } from "@/components/layout/language-query-policy-guard";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import type { CompletionSession } from "@/components/layout/app-shell-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import { createCompletionAnchorStore } from "@/features/editor/completion-anchor-store";
import { createLanguageSessionStore, languageRequestTimeout } from "@/features/language/language-session-store";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";
import type { LanguageCompletionItem, WorkspaceApi } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

const COMPLETION_TIMEOUT_MS = 2500;

export type UseCompletionControllerOptions = {
  workspaceApi: WorkspaceApi;
  rootPath?: string | null;
  activePath: string | null;
  editorSelection: { line: number; column: number };
  quickOpenQuery: string;
  activeOverlay: OverlayKey;
  settingsApplying: boolean;
  getActiveContent: () => string;
  getActiveContentLength?: () => number;
  getActiveContentSlice?: (start: number, end: number) => string;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
  setQuickOpenQuery: (query: string) => void;
  setInsertTextTarget: (target: { text: string; replaceBefore?: number; nonce: number } | null) => void;
  bumpEditorFocusToken: () => void;
  focusEditorSoon: () => void;
  isEditorFocused: () => boolean;
  recordRecentQueryExplain: (entry: QueryExplainRecordInput) => void;
  onStatusChange: (message: string) => void;
};

export function useCompletionController({
  workspaceApi,
  rootPath,
  activePath,
  editorSelection,
  quickOpenQuery,
  activeOverlay,
  settingsApplying,
  getActiveContent,
  getActiveContentLength,
  getActiveContentSlice,
  setActiveOverlay,
  setQuickOpenQuery,
  setInsertTextTarget,
  bumpEditorFocusToken,
  focusEditorSoon,
  isEditorFocused,
  recordRecentQueryExplain,
  onStatusChange,
}: UseCompletionControllerOptions) {
  const completionAnchorStore = useMemo(() => createCompletionAnchorStore(), []);
  const setCompletionAnchor = completionAnchorStore.setAnchor;
  const [completionItems, setCompletionItems] = useState<LanguageCompletionItem[]>([]);
  const [completionReplacePrefix, setCompletionReplacePrefix] = useState("");
  const [completionSelectedIndex, setCompletionSelectedIndex] = useState(0);
  const [completionTrigger, setCompletionTrigger] = useState<"manual" | "typing">("typing");
  const [completionStatus, setCompletionStatus] = useState<"ready" | "empty" | "error">("empty");
  const [completionMessage, setCompletionMessage] = useState<string | undefined>();
  const [completionSession, setCompletionSession] = useState<CompletionSession | null>(null);
  const [completionHistoryVersion, setCompletionHistoryVersion] = useState(0);
  const completionHistoryStore = useMemo(() => createCompletionHistoryStore(), []);
  const languageSessionStore = useMemo(() => createLanguageSessionStore(), []);
  const completionRequestRef = useRef(0);
  const typingCompletionTimerRef = useRef<number | null>(null);

  function clearTypingCompletionTimer() {
    if (typingCompletionTimerRef.current != null) {
      window.clearTimeout(typingCompletionTimerRef.current);
      typingCompletionTimerRef.current = null;
    }
  }

  function clearCompletionSession() {
    completionRequestRef.current += 1;
    languageSessionStore.cancel("completion");
    setCompletionItems([]);
    setCompletionReplacePrefix("");
    setCompletionSelectedIndex(0);
    setCompletionStatus("empty");
    setCompletionMessage(undefined);
    setCompletionSession(null);
    setActiveOverlay((current) => (current === "completion" ? "none" : current));
  }

  function resetCompletion() {
    clearCompletionSession();
    setCompletionAnchor(null);
  }

  async function requestCompletion(
    trigger: "manual" | "typing",
    selectionOverride?: { line: number; column: number },
  ) {
    if (trigger === "manual") {
      clearTypingCompletionTimer();
    }
    if (settingsApplying) {
      onStatusChange("SDK settings are still applying");
      return;
    }
    if (!activePath) {
      onStatusChange("Completion unavailable");
      return;
    }
    const languageSession = languageSessionStore.begin("completion", `completion:${trigger}`, COMPLETION_TIMEOUT_MS);
    const requestId = languageSession.requestId;
    completionRequestRef.current = requestId;
    const path = activePath;
    const snapshot = buildLanguageQuerySnapshot({
      activePath: path,
      editorSelection: selectionOverride ?? editorSelection,
      getActiveContent,
      getActiveContentLength,
      getActiveContentSlice,
    });
    languageQuerySnapshotStore.record({ kind: "completion", snapshot });
    const syncDecision = decideLanguageQuerySync(snapshot);
    if (!syncDecision.allowSyncRequest) {
      languageSessionStore.complete(languageSession);
      const message = formatLanguageQuerySyncBlockedMessage("Completion", syncDecision);
      setCompletionItems([]);
      setCompletionReplacePrefix("");
      setCompletionSelectedIndex(0);
      setCompletionSession(null);
      setCompletionTrigger(trigger);
      setCompletionStatus("empty");
      setCompletionMessage(message);
      setActiveOverlay((current) => (current === "completion" ? "none" : current));
      focusEditorSoon();
      onStatusChange(message);
      return;
    }
    const request = snapshot.request;
    const replacePrefix = extractCompletionPrefix(request.content, request.line, request.column);
    const query = trigger === "typing" ? replacePrefix : "";
    let completionResult: { items: LanguageCompletionItem[]; explain?: string[] };
    try {
      completionResult = await languageRequestTimeout(collectCompletionCandidateResult({
        workspaceApi,
        rootPath,
        path,
        line: request.line,
        column: request.column,
        content: request.content,
        query,
        replacePrefix,
      }), languageSession.timeoutMs);
    } catch (error) {
      if (completionRequestRef.current !== requestId || !languageSessionStore.isCurrent(languageSession)) return;
      languageSessionStore.complete(languageSession);
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
        bumpEditorFocusToken();
      } else {
        setActiveOverlay((current) => (current === "completion" ? "none" : current));
      }
      focusEditorSoon();
      onStatusChange(`Completion failed: ${message}`);
      return;
    }
    if (completionRequestRef.current !== requestId || !languageSessionStore.isCurrent(languageSession)) return;
    languageSessionStore.complete(languageSession);

    const results = completionResult.items;
    const emptyCompletionExplanation = results.length === 0
      ? formatQueryEnvelopeExplain(completionResult.explain)
      : null;
    if (emptyCompletionExplanation) {
      recordRecentQueryExplain({
        kind: "completion",
        query: query || replacePrefix || `${getPathBasename(path)}:${request.line}:${request.column}`,
        message: emptyCompletionExplanation,
        explain: completionResult.explain,
      });
    }
    setCompletionItems(results);
    setCompletionReplacePrefix(replacePrefix);
    setCompletionSession({ path, line: request.line, replacePrefix });
    setCompletionSelectedIndex(0);
    setQuickOpenQuery(query);
    setCompletionTrigger(trigger);
    setCompletionStatus(results.length > 0 ? "ready" : "empty");
    setCompletionMessage(results.length > 0 ? undefined : emptyCompletionExplanation ?? "No completions");
    setActiveOverlay((trigger === "manual" || results.length > 0) ? "completion" : (current) => (
      current === "completion" ? "none" : current
    ));
    onStatusChange(results.length > 0 ? `Completion: ${results.length} items` : "Completion empty");
    if (trigger === "manual") {
      bumpEditorFocusToken();
    }
    focusEditorSoon();
  }

  async function openCompletionFromEditor() {
    await requestCompletion("manual");
  }

  function triggerTypingCompletion(selection: { line: number; column: number }) {
    clearTypingCompletionTimer();
    if (settingsApplying) {
      onStatusChange("SDK settings are still applying");
      return;
    }
    typingCompletionTimerRef.current = window.setTimeout(() => {
      void requestCompletion("typing", selection);
    }, 120);
  }

  function insertCompletionItem(item: CompletionPresentation) {
    const insertTarget = buildCompletionInsertTarget({
      item,
      selection: editorSelection,
      content: getActiveContent(),
      fallbackPrefix: completionReplacePrefix,
    });
    completionRequestRef.current += 1;
    languageSessionStore.cancel("completion");
    completionHistoryStore.recordAccepted(item.label);
    setCompletionHistoryVersion((version) => version + 1);
    setInsertTextTarget({ ...insertTarget, nonce: Date.now() });
    setCompletionItems([]);
    setCompletionReplacePrefix("");
    setCompletionSelectedIndex(0);
    setCompletionStatus("empty");
    setCompletionMessage(undefined);
    setCompletionSession(null);
    setActiveOverlay("none");
    bumpEditorFocusToken();
    onStatusChange(`Inserted completion: ${item.label}`);
    focusEditorSoon();
  }

  function moveCompletionSelection(direction: 1 | -1, resultCount: number) {
    if (resultCount <= 0) return;
    setCompletionSelectedIndex((current) => {
      const normalized = Math.min(Math.max(current, 0), resultCount - 1);
      return (normalized + direction + resultCount) % resultCount;
    });
  }

  function moveCompletionSelectionByPage(direction: 1 | -1, resultCount: number) {
    if (resultCount <= 0) return;
    setCompletionSelectedIndex((current) => {
      const normalized = Math.min(Math.max(current, 0), resultCount - 1);
      return clampNumber(normalized + direction * COMPLETION_PAGE_STEP, 0, resultCount - 1);
    });
  }

  function setCompletionSelectionBoundary(position: "first" | "last", resultCount: number) {
    if (resultCount <= 0) return;
    setCompletionSelectedIndex(position === "first" ? 0 : resultCount - 1);
  }

  function syncCompletionForEditorSelection(selection: { line: number; column: number }) {
    if (!completionSession || !activePath || normalizePath(completionSession.path) !== normalizePath(activePath)) {
      return;
    }
    if (selection.line !== completionSession.line) {
      if (activeOverlay === "completion") {
        setActiveOverlay("none");
      }
      return;
    }
    if (activeOverlay !== "none") {
      return;
    }
    const currentPrefix = extractCompletionPrefix(getActiveContent(), selection.line, selection.column);
    const sessionPrefix = completionSession.replacePrefix;
    const prefixCompatible = currentPrefix.startsWith(sessionPrefix) || sessionPrefix.startsWith(currentPrefix);
    if (prefixCompatible && completionItems.length > 0) {
      setQuickOpenQuery(completionTrigger === "typing" ? currentPrefix : "");
      setActiveOverlay("completion");
    }
  }

  const completionPresentationContext = useMemo(() => {
    const acceptedLabels = completionHistoryStore.acceptedLabels();
    const activeContent = completionItems.length > 0 ? getActiveContent() : "";
    return {
      prefix: quickOpenQuery.trim() || completionReplacePrefix,
      lineTextBeforeCursor: getLineTextBeforeCursor(activeContent, editorSelection.line, editorSelection.column),
      trigger: completionTrigger,
      acceptedLabels,
    } as const;
  }, [completionHistoryStore, completionHistoryVersion, completionItems.length, completionReplacePrefix, completionTrigger, editorSelection.column, editorSelection.line, getActiveContent, quickOpenQuery]);

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
  const selectedCompletionPresentation = completionPresentationResults[
    Math.min(completionSelectedIndex, Math.max(completionPresentationResults.length - 1, 0))
  ] ?? null;
  const completionPopupVisible = activeOverlay === "completion"
    && (completionPresentationResults.length > 0 || completionTrigger === "manual" || completionStatus === "error");

  useEffect(() => {
    setCompletionSelectedIndex((current) => {
      const resultCount = completionPresentationResults.length;
      if (resultCount === 0) return 0;
      return Math.min(current, resultCount - 1);
    });
  }, [completionPresentationResults.length]);

  useEffect(() => () => {
    clearTypingCompletionTimer();
  }, []);

  useEffect(() => {
    if (activeOverlay === "none" || activeOverlay === "completion") return;
    clearTypingCompletionTimer();
    completionRequestRef.current += 1;
    languageSessionStore.cancel("completion");
  }, [activeOverlay, languageSessionStore]);

  useEffect(() => {
    function handleCompletionAcceptKey(event: KeyboardEvent) {
      if (activeOverlay !== "completion" || !isEditorFocused()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        clearCompletionSession();
        focusEditorSoon();
        return;
      }
      if (completionPresentationResults.length === 0) return;

      const editorNavigationModifier = event.ctrlKey || event.metaKey || event.altKey;
      if (!editorNavigationModifier && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        event.stopPropagation();
        moveCompletionSelection(event.key === "ArrowDown" ? 1 : -1, completionPresentationResults.length);
        return;
      }
      if (!editorNavigationModifier && (event.key === "PageDown" || event.key === "PageUp")) {
        event.preventDefault();
        event.stopPropagation();
        moveCompletionSelectionByPage(event.key === "PageDown" ? 1 : -1, completionPresentationResults.length);
        return;
      }
      if (!editorNavigationModifier && (event.key === "Home" || event.key === "End")) {
        event.preventDefault();
        event.stopPropagation();
        setCompletionSelectionBoundary(event.key === "Home" ? "first" : "last", completionPresentationResults.length);
        return;
      }
      if (event.key !== "Tab" && event.key !== "Enter") return;

      event.preventDefault();
      event.stopPropagation();
      if (selectedCompletionPresentation) {
        insertCompletionItem(selectedCompletionPresentation);
      }
    }

    window.addEventListener("keydown", handleCompletionAcceptKey, true);
    return () => window.removeEventListener("keydown", handleCompletionAcceptKey, true);
  }, [activeOverlay, completionPresentationResults.length, selectedCompletionPresentation]);

  return {
    completionAnchorStore,
    setCompletionAnchor,
    completionSelectedIndex,
    setCompletionSelectedIndex,
    completionStatus,
    completionMessage,
    completionPresentationResults,
    selectedCompletionPresentation,
    completionPopupVisible,
    clearTypingCompletionTimer,
    clearCompletionSession,
    resetCompletion,
    openCompletionFromEditor,
    triggerTypingCompletion,
    insertCompletionItem,
    syncCompletionForEditorSelection,
  };
}
