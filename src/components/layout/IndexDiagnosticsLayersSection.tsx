import type { WorkspaceIndexLayerReadiness } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexLayerReadinessReport } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";
import { formatLayerCounts, getLayerActionState } from "@/components/layout/index-diagnostics-model";

type IndexDiagnosticsLayersSectionProps = {
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
  taskStatuses?: WorkspaceIndexTaskStatus[];
  onAction?: (action: string) => void;
};

export function IndexDiagnosticsLayersSection({
  layerReadiness,
  taskStatuses = [],
  onAction,
}: IndexDiagnosticsLayersSectionProps) {
  const layers = layerReadiness?.layers ?? [];

  return (
    <section className="index-diagnostics__section" id="index-diagnostics-layers" aria-label="Index Layers">
      <div className="index-diagnostics__section-title">
        <h3>Index Layers</h3>
        <span>{layers.length} layers</span>
      </div>
      <div className="index-diagnostics__table">
        <div className="index-diagnostics__row index-diagnostics__row--header index-diagnostics__row--layers">
          <span>Layer</span>
          <span>Workspace</span>
          <span>Current file</span>
          <span>Counts</span>
          <span>Impact</span>
          <span>Action</span>
        </div>
        {layers.length > 0 ? layers.map((layer) => (
          <LayerReadinessRow
            currentFilePath={layerReadiness?.currentFilePath ?? null}
            layer={layer}
            key={layer.layer}
            taskStatuses={taskStatuses}
            onAction={onAction}
          />
        )) : (
          <div className="index-diagnostics__empty">No layer readiness evidence is available.</div>
        )}
      </div>
    </section>
  );
}

function LayerReadinessRow({
  currentFilePath,
  layer,
  taskStatuses,
  onAction,
}: {
  currentFilePath: string | null;
  layer: WorkspaceIndexLayerReadiness;
  taskStatuses: WorkspaceIndexTaskStatus[];
  onAction?: (action: string) => void;
}) {
  const action = layer.recommendedAction;
  const actionState = getLayerActionState(action, taskStatuses, currentFilePath);
  const canRunAction = action != null && action !== "wait" && action !== "none";
  const actionReason = actionState.reason ?? layer.reason;

  return (
    <div className="index-diagnostics__row index-diagnostics__row--layers">
      <span>{layer.layer}</span>
      <StatusBadge value={layer.workspaceStatus} />
      <StatusBadge value={layer.currentFileStatus ?? "none"} />
      <span>{formatLayerCounts(layer)}</span>
      <span>{formatLayerImpact(layer.layer)}</span>
      <span>
        {canRunAction ? (
          <button
            type="button"
            className="toolbar__button"
            disabled={actionState.disabled}
            title={actionState.reason ?? undefined}
            onClick={() => onAction?.(action)}
          >
            {formatLayerAction(action)}
          </button>
        ) : formatLayerAction(action)}
        {actionReason ? <small>{actionReason}</small> : null}
      </span>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`index-diagnostics__status index-diagnostics__status--${value}`}>{value}</span>;
}

function formatLayerAction(action: string | null) {
  switch (action) {
    case "configureSdk":
      return "Configure SDK";
    case "indexCurrentFile":
      return "Index Current File";
    case "inspectParserFailures":
      return "Inspect Parser Failures";
    case "rebuildIndex":
      return "Rebuild Project Index";
    case "wait":
      return "Wait for Index";
    case "openFile":
      return "Open File";
    case null:
    case "none":
      return "none";
    default:
      return action;
  }
}

function formatLayerImpact(layer: string) {
  switch (layer) {
    case "fileHot":
      return "Navigation · Completion";
    case "projectFile":
    case "fileCatalog":
      return "Files · Quick open";
    case "projectDeep":
      return "Search · Usages · Dependencies";
    case "content":
      return "Text search";
    case "stub":
      return "Parser · Members";
    case "symbols":
      return "Symbols · Navigation";
    case "references":
      return "Find usages";
    case "dependencyGraph":
      return "Imports · Refresh";
    case "sdk":
    case "sdkApi":
      return "SDK API · Completion";
    case "discovery":
      return "Workspace files";
    case "fingerprint":
      return "Incremental refresh";
    default:
      return "IDE features";
  }
}
