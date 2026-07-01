import type { WorkspaceIndexExplainResult } from "@/features/workspace/workspace-api";

const actionLabels: Record<NonNullable<WorkspaceIndexExplainResult["recommendedAction"]>, string> = {
  wait: "Wait for indexing",
  rebuildIndex: "Rebuild Index",
  configureSdk: "Configure SDK",
  openFile: "Open File",
  reportBug: "Report Bug",
};

export function formatIndexExplainMessage(result: WorkspaceIndexExplainResult) {
  const action = result.recommendedAction ? actionLabels[result.recommendedAction] : null;
  return action ? `${result.message}. ${action}.` : result.message;
}
