import { useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import {
  decideDefinitionEnvelope,
  definitionCandidatesToUsageItems,
  formatDefinitionBlockedDebugMessage,
  formatDefinitionBlockedStatus,
  formatDefinitionCandidateDebugMessage,
  formatDefinitionCandidatePanelMessage,
  formatDefinitionCandidateStatus,
  formatDefinitionEnvelopeExplanation,
  formatDefinitionMissMessage,
  formatDefinitionQueryDebugMessage,
  formatDefinitionQueryStatus,
  formatDefinitionRefreshWaitMessage,
  formatDefinitionResolvedDebugMessage,
  formatDefinitionResolvedStatus,
  formatDefinitionUnavailableDebugMessage,
  formatDefinitionUnavailableStatus,
  type DefinitionCandidateSource,
  type DefinitionMissCause,
  type DefinitionPanelCandidate,
  type DefinitionQuerySource,
  type DefinitionReadinessState,
  type DefinitionResolvedSource,
} from "@/features/workspace/definition-query-model";
import { findWorkspaceDefinition, findWorkspaceDefinitionCandidates } from "@/features/workspace/local-definition";
import { createLanguageSessionStore, languageRequestTimeout } from "@/features/language/language-session-store";
import type { UsageSearchState } from "@/features/workspace/usage-search";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

const DEFINITION_TIMEOUT_MS = 3500;

export type UseDefinitionControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorSelection: { line: number; column: number };
  getActiveContent: () => string;
  settingsApplying: boolean;
  openEditorQueryPanel: () => void;
  setUsageSearch: Dispatch<SetStateAction<UsageSearchState>>;
  rememberCurrentLocation: () => void;
  openFile: (path: string) => Promise<void>;
  setSelectionTarget: (target: { line: number; column: number; nonce: number } | null) => void;
  bumpEditorFocusToken: () => void;
  focusEditorSoon: () => void;
  explainIndexMiss: (
    kind: "definition",
    query: string,
    path?: string,
    line?: number,
    column?: number,
  ) => Promise<string | null>;
  recordRecentQueryExplain: (entry: {
    kind: "definition";
    query: string;
    message: string;
    explain?: string[];
  }) => void;
  onStatusChange: (message: string) => void;
};

export function useDefinitionController({
  workspaceApi,
  workspace,
  activePath,
  editorSelection,
  getActiveContent,
  settingsApplying,
  openEditorQueryPanel,
  setUsageSearch,
  rememberCurrentLocation,
  openFile,
  setSelectionTarget,
  bumpEditorFocusToken,
  focusEditorSoon,
  explainIndexMiss,
  recordRecentQueryExplain,
  onStatusChange,
}: UseDefinitionControllerOptions) {
  const [definitionDebugText, setDefinitionDebugText] = useState("");
  const languageSessionStore = useMemo(() => createLanguageSessionStore(), []);
  const definitionRequestRef = useRef(0);

  function setDefinitionDebug(message: string) {
    setDefinitionDebugText(message);
  }

  async function goToDefinitionFromEditor(
    selectionOverride?: { line: number; column: number },
    source: DefinitionQuerySource = "keyboard",
  ) {
    if (source === "modifierClick" && !selectionOverride) {
      const debugMessage = formatDefinitionUnavailableDebugMessage(source, "missingPosition");
      if (debugMessage) setDefinitionDebug(debugMessage);
      onStatusChange(formatDefinitionUnavailableStatus("missingPosition"));
      return;
    }
    if (settingsApplying) {
      const debugMessage = formatDefinitionUnavailableDebugMessage(source, "settingsApplying");
      if (debugMessage) setDefinitionDebug(debugMessage);
      onStatusChange(formatDefinitionUnavailableStatus("settingsApplying"));
      return;
    }
    if (!activePath || (!workspaceApi.gotoDefinition && !workspaceApi.queryDefinitionCandidatesWithReadiness)) {
      const debugMessage = formatDefinitionUnavailableDebugMessage(source, "lookupUnavailable");
      if (debugMessage) setDefinitionDebug(debugMessage);
      onStatusChange(formatDefinitionUnavailableStatus("lookupUnavailable"));
      return;
    }
    const currentContent = getActiveContent();
    const languageSession = languageSessionStore.begin("definition", "definition:editor", DEFINITION_TIMEOUT_MS);
    const requestId = languageSession.requestId;
    definitionRequestRef.current = requestId;
    const isStaleRequest = () => definitionRequestRef.current !== requestId || !languageSessionStore.isCurrent(languageSession);
    const completeDefinitionRequest = () => languageSessionStore.complete(languageSession);
    const request = {
      path: activePath,
      line: selectionOverride?.line ?? editorSelection.line,
      column: selectionOverride?.column ?? editorSelection.column,
      content: currentContent,
    };
    const activeBasename = getPathBasename(activePath);
    onStatusChange(formatDefinitionQueryStatus(source, activeBasename, request.line, request.column));
    const queryDebugMessage = formatDefinitionQueryDebugMessage(source, activeBasename, request.line, request.column);
    if (queryDebugMessage) setDefinitionDebug(queryDebugMessage);

    const showDefinitionCandidates = (
      candidates: DefinitionPanelCandidate[],
      candidateSource: DefinitionCandidateSource,
      message?: string,
    ) => {
      if (isStaleRequest()) return;
      openEditorQueryPanel();
      setUsageSearch({
        status: "ready",
        items: definitionCandidatesToUsageItems(candidates),
        requestedSymbol: request,
        message,
      });
      onStatusChange(formatDefinitionCandidateStatus(candidates.length));
      const debugMessage = formatDefinitionCandidateDebugMessage(source, candidateSource, candidates.length);
      if (debugMessage) setDefinitionDebug(debugMessage);
    };

    const showResolvedDefinition = async (
      target: Pick<DefinitionPanelCandidate, "path" | "line" | "column">,
      resolvedSource: DefinitionResolvedSource,
      readinessState?: DefinitionReadinessState,
    ) => {
      rememberCurrentLocation();
      if (normalizePath(target.path) !== normalizePath(activePath)) await openFile(target.path);
      if (isStaleRequest()) return;
      setSelectionTarget({
        line: target.line,
        column: target.column,
        nonce: Date.now(),
      });
      bumpEditorFocusToken();
      const targetBasename = getPathBasename(target.path);
      onStatusChange(formatDefinitionResolvedStatus(target, targetBasename, resolvedSource));
      const resolvedDebugMessage = formatDefinitionResolvedDebugMessage(
        source,
        target,
        targetBasename,
        resolvedSource,
        readinessState,
      );
      if (resolvedDebugMessage) setDefinitionDebug(resolvedDebugMessage);
      focusEditorSoon();
    };

    let indexedDefinitionExplain: string[] | undefined;
    const showDefinitionMiss = async (cause: DefinitionMissCause) => {
      const query = `${activeBasename}:${request.line}:${request.column}`;
      const envelopeExplanation = formatDefinitionEnvelopeExplanation(indexedDefinitionExplain);
      const explanation = envelopeExplanation
        ?? await explainIndexMiss("definition", query, activePath, request.line, request.column);
      if (isStaleRequest()) return;
      const missMessage = formatDefinitionMissMessage({ source, cause, explanation });
      if (envelopeExplanation) {
        recordRecentQueryExplain({
          kind: "definition",
          query,
          message: missMessage,
          explain: indexedDefinitionExplain,
        });
      }
      setDefinitionDebug(missMessage);
      onStatusChange(missMessage);
    };

    if (workspace?.rootPath && workspaceApi.queryDefinitionCandidatesWithReadiness) {
      await scheduleForegroundNavigationIndex(workspaceApi, workspace.rootPath, activePath);
      if (isStaleRequest()) return;
      let envelope;
      try {
        envelope = await languageRequestTimeout(
          workspaceApi.queryDefinitionCandidatesWithReadiness(workspace.rootPath, request),
          languageSession.timeoutMs,
        );
      } catch (error) {
        if (isStaleRequest()) return;
        const message = error instanceof Error ? error.message : String(error);
        setDefinitionDebug(`Go to Definition failed: ${message}`);
        onStatusChange(`Go to Definition failed: ${message}`);
        completeDefinitionRequest();
        return;
      }
      if (isStaleRequest()) return;
      indexedDefinitionExplain = envelope.explain;
      const decision = decideDefinitionEnvelope(envelope);
      if (decision.kind === "blocked") {
        const blockedDebugMessage = formatDefinitionBlockedDebugMessage(source, decision.message);
        if (blockedDebugMessage) setDefinitionDebug(blockedDebugMessage);
        onStatusChange(formatDefinitionBlockedStatus(decision.message));
        completeDefinitionRequest();
        return;
      }
      if (decision.kind === "candidates") {
        showDefinitionCandidates(
          decision.items,
          "indexed",
          formatDefinitionCandidatePanelMessage(decision.readinessState),
        );
        completeDefinitionRequest();
        return;
      }
      if (decision.kind === "resolved") {
        await showResolvedDefinition(decision.target, "indexed", decision.readinessState);
        completeDefinitionRequest();
        return;
      }
      if (decision.kind === "waitForRefresh") {
        const message = formatDefinitionRefreshWaitMessage(decision.count, decision.readinessState);
        if (source === "modifierClick") setDefinitionDebug(message);
        onStatusChange(message);
        completeDefinitionRequest();
        return;
      }
    }

    if (!workspaceApi.gotoDefinition) {
      await showDefinitionMiss("indexedNoTarget");
      completeDefinitionRequest();
      return;
    }

    let target;
    try {
      target = await languageRequestTimeout(workspaceApi.gotoDefinition(request), languageSession.timeoutMs);
    } catch (error) {
      if (isStaleRequest()) return;
      const message = error instanceof Error ? error.message : String(error);
      setDefinitionDebug(`Go to Definition failed: ${message}`);
      onStatusChange(`Go to Definition failed: ${message}`);
      languageSessionStore.complete(languageSession);
      return;
    }
    if (isStaleRequest()) return;
    const semanticCandidates = target || !workspaceApi.gotoDefinitionCandidates
      ? []
      : await workspaceApi.gotoDefinitionCandidates(request);
    if (isStaleRequest()) return;
    if (semanticCandidates.length > 1) {
      showDefinitionCandidates(semanticCandidates, "semantic");
      completeDefinitionRequest();
      return;
    }

    const fallbackRequest = {
      path: activePath,
      content: currentContent,
      line: request.line,
      column: request.column,
      workspaceFiles: workspace?.visibleFiles ?? [activePath],
      readFile: async (path: string) => {
        if (normalizePath(path) === normalizePath(activePath)) {
          return getActiveContent();
        }
        try {
          return await workspaceApi.openFile(path);
        } catch {
          return null;
        }
      },
    };
    const resolvedTarget = target ?? await findWorkspaceDefinition(fallbackRequest);
    if (isStaleRequest()) return;
    if (!resolvedTarget) {
      const fallbackCandidates = target ? [] : await findWorkspaceDefinitionCandidates(fallbackRequest);
      if (isStaleRequest()) return;
      if (fallbackCandidates.length > 1) {
        showDefinitionCandidates(fallbackCandidates, "fallback");
        completeDefinitionRequest();
        return;
      }
      await showDefinitionMiss("languageAndFallbackNoTarget");
      completeDefinitionRequest();
      return;
    }
    const resolvedSource = target ? "semantic" : "fallback";
    await showResolvedDefinition(resolvedTarget, resolvedSource);
    completeDefinitionRequest();
  }

  return { definitionDebugText, goToDefinitionFromEditor };
}

async function scheduleForegroundNavigationIndex(
  workspaceApi: WorkspaceApi,
  rootPath: string,
  activePath: string,
) {
  if (!workspaceApi.scheduleForegroundNavigationIndex) {
    return;
  }
  try {
    await workspaceApi.scheduleForegroundNavigationIndex(rootPath, [activePath]);
  } catch {
    // Navigation lookup should still use existing index/fallback if scheduling is unavailable.
  }
}
