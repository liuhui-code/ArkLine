import type { WorkspaceIndexLayerReadiness } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexLayerReadinessReport } from "@/features/workspace/workspace-api";
import { formatLayerCounts } from "@/components/layout/index-diagnostics-model";

type IndexDiagnosticsLayersSectionProps = {
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
};

export function IndexDiagnosticsLayersSection({ layerReadiness }: IndexDiagnosticsLayersSectionProps) {
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
          <span>Action</span>
        </div>
        {layers.length > 0 ? layers.map((layer) => (
          <LayerReadinessRow layer={layer} key={layer.layer} />
        )) : (
          <div className="index-diagnostics__empty">No layer readiness evidence is available.</div>
        )}
      </div>
    </section>
  );
}

function LayerReadinessRow({ layer }: { layer: WorkspaceIndexLayerReadiness }) {
  return (
    <div className="index-diagnostics__row index-diagnostics__row--layers">
      <span>{layer.layer}</span>
      <StatusBadge value={layer.workspaceStatus} />
      <StatusBadge value={layer.currentFileStatus ?? "none"} />
      <span>{formatLayerCounts(layer)}</span>
      <span>
        {layer.recommendedAction ?? "none"}
        {layer.reason ? <small>{layer.reason}</small> : null}
      </span>
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  return <span className={`index-diagnostics__status index-diagnostics__status--${value}`}>{value}</span>;
}
