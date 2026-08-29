import type {
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexQueryScope,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-index-api-types";

export type WorkspaceIndexPublicationRevisions = Readonly<Record<string, number>>;

const QUERY_SCOPE_LAYERS: Record<WorkspaceIndexQueryScope, readonly string[]> = {
  all: ["fileCatalog", "stub", "symbols", "sdk", "sdkApi", "content", "contentSubstring"],
  files: ["fileCatalog"],
  classes: ["stub", "symbols"],
  symbols: ["stub", "symbols"],
  api: ["sdk", "sdkApi"],
  text: ["content", "contentSubstring"],
};

export function workspaceIndexPublicationRevisions(
  report: WorkspaceIndexLayerReadinessReport | null,
): WorkspaceIndexPublicationRevisions {
  if (!report) return {};
  return Object.fromEntries(
    report.layers.flatMap((layer) => typeof layer.publicationRevision === "number"
      ? [[layer.layer, layer.publicationRevision] as const]
      : []),
  );
}

export function workspaceIndexQueryVersionKey(
  catalogVersionKey: string,
  scope: WorkspaceIndexQueryScope,
  revisions: WorkspaceIndexPublicationRevisions,
  fallbackPublicationKey = "",
) {
  const relevantLayers = QUERY_SCOPE_LAYERS[scope];
  const layerKey = relevantLayers.map((layer) => `${layer}:${revisions[layer] ?? 0}`).join(",");
  const hasCommittedRevision = relevantLayers.some((layer) => revisions[layer] != null);
  return `${catalogVersionKey}|${layerKey}|fallback:${hasCommittedRevision ? "" : fallbackPublicationKey}`;
}

export function workspaceIndexTaskPublicationFallbackKey(statuses: WorkspaceIndexTaskStatus[]) {
  return statuses
    .filter((status) => status.status === "ready" || status.status === "partial")
    .map((status) => [
      status.taskId,
      status.status,
      status.generation,
      status.progressCurrent ?? 0,
      status.progressTotal ?? 0,
    ].join(":"))
    .sort()
    .join(",");
}
