import { useState } from "react";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";
import { getPathBasename } from "@/features/workspace/workspace-store";
import { idleUsageSearchState, type UsageResult, type UsageSearchState } from "@/features/workspace/usage-search";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

export type UseUsagesControllerOptions = {
  workspaceApi: WorkspaceApi;
  workspace: WorkspaceViewModel | null;
  activePath: string | null;
  editorSelection: { line: number; column: number };
  getActiveContent: () => string;
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
  settingsApplying,
  rememberCurrentLocation,
  navigateToUsage,
  recordRecentQueryExplain,
  onStatusChange,
}: UseUsagesControllerOptions) {
  const [usageSearch, setUsageSearch] = useState<UsageSearchState>(idleUsageSearchState());
  const [queryPanelVisible, setQueryPanelVisible] = useState(false);

  function openEditorQueryPanel() {
    setQueryPanelVisible(true);
  }

  function closeEditorQueryPanel() {
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
    const request = {
      path: activePath,
      line: editorSelection.line,
      column: editorSelection.column,
      content: getActiveContent(),
    };
    setUsageSearch({ status: "loading", items: [], requestedSymbol: request });
    try {
      const envelope = workspace?.rootPath && workspaceApi.queryUsagesWithReadiness
        ? await workspaceApi.queryUsagesWithReadiness(workspace.rootPath, request)
        : null;
      const items = envelope?.items ?? await workspaceApi.findUsages?.(request) ?? [];
      const readinessMessage = envelope && envelope.readiness.state !== "ready"
        ? `Index is ${envelope.readiness.state}; usages may be incomplete`
        : undefined;
      const envelopeExplanation = items.length === 0
        ? formatQueryEnvelopeExplain(envelope?.explain)
        : null;
      setUsageSearch({
        status: items.length > 0 ? "ready" : "empty",
        items,
        requestedSymbol: request,
        message: items.length > 0 ? readinessMessage : envelopeExplanation ?? readinessMessage ?? "No usages found",
      });
      if (envelopeExplanation) {
        recordRecentQueryExplain({
          kind: "usages",
          query: `${getPathBasename(activePath)}:${request.line}:${request.column}`,
          message: envelopeExplanation,
          explain: envelope?.explain,
        });
      }
      onStatusChange(items.length > 0 ? `Usages: ${items.length} matches` : "Usages: none");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setUsageSearch({ status: "error", items: [], requestedSymbol: request, message });
      onStatusChange(`Find Usages failed: ${message}`);
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
