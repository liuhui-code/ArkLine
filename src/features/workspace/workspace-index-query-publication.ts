import type {
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexQueryScope,
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
) {
  const layerKey = QUERY_SCOPE_LAYERS[scope]
    .map((layer) => `${layer}:${revisions[layer] ?? 0}`)
    .join(",");
  return `${catalogVersionKey}|${layerKey}`;
}
