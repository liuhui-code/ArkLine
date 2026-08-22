import { useMemo, useRef, useState } from "react";
import { createLanguageSessionStore, languageRequestTimeout } from "@/features/language/language-session-store";
import { buildLanguageQuerySnapshot } from "@/components/layout/language-query-request-model";
import { decideLanguageQuerySync, formatLanguageQuerySyncBlockedMessage } from "@/components/layout/language-query-policy-guard";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";
import { getPathBasename } from "@/features/workspace/workspace-store";
import { idleUsageSearchState, type UsageResult, type UsageSearchState } from "@/features/workspace/usage-search";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

const USAGES_TIMEOUT_MS = 3500;

export type UseUsagesControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorSelection: { line: number; column: number };
  getActiveContent: () => string;
  getActiveContentLength?: () => number;
  getActiveContentSlice?: (start: number, end: number) => string;
  getActiveContentWindow?: (selection: { line: number; column: number }, budget: number) => string;
  settingsApplying: boolean;
  rememberCurrentLocation: () => void;
  navigateToUsage: (item: UsageResult) => Promise<void>;
  recordRecentQueryExplain: (entry: {
    kind: "usages";
    query: string;
    message: string;
    explain?: string[];
  }) => void;
  onStatusChange: (message: string) => void;
};

export function useUsagesController({
  workspaceApi,
  workspace,
  activePath,
  editorSelection,
  getActiveContent,
  getActiveContentLength,
  getActiveContentSlice,
  getActiveContentWindow,
  settingsApplying,
  rememberCurrentLocation,
  navigateToUsage,
  recordRecentQueryExplain,
  onStatusChange,
}: UseUsagesControllerOptions) {
  const [usageSearch, setUsageSearch] = useState<UsageSearchState>(idleUsageSearchState());
  const [queryPanelVisible, setQueryPanelVisible] = useState(false);
  const languageSessionStore = useMemo(() => createLanguageSessionStore(), []);
  const usagesRequestRef = useRef(0);

  function openEditorQueryPanel() {
    setQueryPanelVisible(true);
  }

  function closeEditorQueryPanel() {
    languageSessionStore.cancel("usages");
    usagesRequestRef.current += 1;
    setQueryPanelVisible(false);
    setUsageSearch(idleUsageSearchState());
  }

  async function findUsagesFromEditor() {
    if (settingsApplying) {
      onStatusChange("SDK settings are still applying");
      return;
    }
    openEditorQueryPanel();
    if (!activePath || (!workspaceApi.findUsages && !workspaceApi.queryUsagesWithReadiness)) {
      setUsageSearch({ status: "error", items: [], message: "Find Usages unavailable" });
      return;
    }
    const snapshot = buildLanguageQuerySnapshot({
      activePath,
      editorSelection,
      getActiveContent,
      getActiveContentLength,
      getActiveContentSlice,
      getActiveContentWindow,
    });
    languageQuerySnapshotStore.record({ kind: "usages", snapshot });
    const request = snapshot.request;
    const syncDecision = decideLanguageQuerySync(snapshot);
    const hasIndexedUsageQuery = Boolean(workspace?.rootPath && workspaceApi.queryUsagesWithReadiness);
    if (!syncDecision.allowSyncRequest && !hasIndexedUsageQuery) {
      const message = formatLanguageQuerySyncBlockedMessage("Find Usages", syncDecision);
      setUsageSearch({ status: "empty", items: [], requestedSymbol: request, message });
      onStatusChange(message);
      return;
    }
    const languageSession = languageSessionStore.begin("usages", "usages:editor", USAGES_TIMEOUT_MS);
    usagesRequestRef.current = languageSession.requestId;
    const isStaleRequest = () => usagesRequestRef.current !== languageSession.requestId || !languageSessionStore.isCurrent(languageSession);
    setUsageSearch({ status: "loading", items: [], requestedSymbol: request });
    try {
      const envelope = workspace?.rootPath && workspaceApi.queryUsagesWithReadiness
        ? await languageRequestTimeout(workspaceApi.queryUsagesWithReadiness(workspace.rootPath, request), languageSession.timeoutMs)
        : null;
      if (isStaleRequest()) return;
      const semanticResult = envelope
        ? null
        : await languageRequestTimeout(Promise.resolve(workspaceApi.findUsages?.(request)), languageSession.timeoutMs);
      if (isStaleRequest()) return;
      const items = envelope?.items ?? semanticResult?.items ?? [];
      const readinessMessage = envelope && envelope.readiness.state !== "ready"
        ? `Index is ${envelope.readiness.state}; usages may be incomplete`
        : undefined;
      const envelopeExplanation = items.length === 0
        ? formatQueryEnvelopeExplain(envelope?.explain)
        : null;
      const availability = envelope
        ? envelope.readiness.state === "ready"
          ? "ready"
          : items.length > 0 ? "partial" : "unavailable"
        : semanticResult?.availability ?? "unavailable";
      const unavailable = availability === "unavailable" || (availability === "partial" && items.length === 0);
      const partial = availability === "partial" && items.length > 0;
      const message = items.length > 0
        ? semanticResult?.message ?? readinessMessage
        : semanticResult?.message ?? envelopeExplanation ?? readinessMessage
          ?? (availability === "ready" ? "No usages found" : "Find Usages unavailable");
      setUsageSearch({
        status: partial ? "partial" : items.length > 0 ? "ready" : unavailable ? "unavailable" : "empty",
        items,
        requestedSymbol: request,
        message,
      });
      if (envelopeExplanation) {
        recordRecentQueryExplain({
          kind: "usages",
          query: `${getPathBasename(activePath)}:${request.line}:${request.column}`,
          message: envelopeExplanation,
          explain: envelope?.explain,
        });
      }
      onStatusChange(items.length > 0
        ? `Usages: ${items.length} matches${partial ? " (partial)" : ""}`
        : unavailable
          ? `Find Usages unavailable: ${message}`
          : "Usages: none");
      languageSessionStore.complete(languageSession);
    } catch (error) {
      if (isStaleRequest()) return;
      const message = error instanceof Error ? error.message : String(error);
      setUsageSearch({ status: "error", items: [], requestedSymbol: request, message });
      onStatusChange(`Find Usages failed: ${message}`);
      languageSessionStore.complete(languageSession);
    }
  }

  async function openUsageResult(item: UsageResult) {
    rememberCurrentLocation();
    await navigateToUsage(item);
  }

  return {
    usageSearch,
    setUsageSearch,
    queryPanelVisible,
    setQueryPanelVisible,
    openEditorQueryPanel,
    closeEditorQueryPanel,
    findUsagesFromEditor,
    openUsageResult,
  };
}
