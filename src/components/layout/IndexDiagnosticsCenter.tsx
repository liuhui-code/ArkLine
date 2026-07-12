import { useEffect } from "react";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexLayerReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";
import {
  getLayerReadinessStatusText,
} from "@/components/layout/app-shell-model";
import {
  buildIndexDiagnosticsViewModel,
  buildActiveProjectTaskSummary,
  buildActiveSdkTaskSummary,
  formatLayerCounts,
} from "@/components/layout/index-diagnostics-model";
import {
  buildQueryExplainTimeline,
  type RecentQueryExplain,
} from "@/features/workspace/workspace-query-explain-model";
import type { UiLatencySample } from "@/features/performance/ui-latency-monitor";
import type { IpcLatencySample } from "@/features/performance/ipc-latency-store";
import type { RenderPressureSample } from "@/features/performance/render-pressure-store";
import { LanguageQuerySnapshotPanel } from "@/components/layout/LanguageQuerySnapshotPanel";
import { IndexDiagnosticsActiveTaskStrip } from "@/components/layout/IndexDiagnosticsActiveTaskStrip";
import { IndexDiagnosticsCurrentFileSection } from "@/components/layout/IndexDiagnosticsCurrentFileSection";
import { IndexDiagnosticsHealthSection } from "@/components/layout/IndexDiagnosticsHealthSection";
import { IndexDiagnosticsPerformanceTimelineSection } from "@/components/layout/IndexDiagnosticsPerformanceTimelineSection";
import { IndexDiagnosticsProcessesSection } from "@/components/layout/IndexDiagnosticsProcessesSection";
import { IndexDiagnosticsQueryExplainSection } from "@/components/layout/IndexDiagnosticsQueryExplainSection";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import "./index-diagnostics-center.css";

type IndexDiagnosticsCenterProps = {
  open: boolean;
  loading: boolean;
  sectionTarget?: string | null;
  activePath: string | null;
  currentFileDirty: boolean;
  diagnostics: WorkspaceIndexDiagnostics | null;
  fileReadiness: WorkspaceIndexFileReadiness | null;
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
  recentQueryExplains: RecentQueryExplain[];
  taskStatuses: WorkspaceIndexTaskStatus[];
  uiLatencySamples?: UiLatencySample[];
  ipcLatencySamples?: IpcLatencySample[];
  renderPressureSamples?: RenderPressureSample[];
  onClose: () => void;
  onRefresh: () => void;
  onResumeIndexing: () => void;
  onRebuildProjectIndex: () => void;
  onRebuildSdkIndex: () => void;
  onConfigureSdk: () => void;
};

export function IndexDiagnosticsCenter({
  open,
  loading,
  sectionTarget = null,
  activePath,
  currentFileDirty,
  diagnostics,
  fileReadiness,
  layerReadiness,
  recentQueryExplains,
  taskStatuses,
  uiLatencySamples = [],
  ipcLatencySamples = [],
  renderPressureSamples = [],
  onClose,
  onRefresh,
  onResumeIndexing,
  onRebuildProjectIndex,
  onRebuildSdkIndex,
  onConfigureSdk,
}: IndexDiagnosticsCenterProps) {
  useEffect(() => {
    if (!open || !sectionTarget) return;
    document.getElementById(sectionTarget)?.scrollIntoView({ block: "start" });
  }, [open, sectionTarget]);

  if (!open) {
    return null;
  }

  const queryEvents = diagnostics?.recentEvents.filter((event) => event.scope === "query") ?? [];
  const queryTimeline = buildQueryExplainTimeline({ frontend: recentQueryExplains, backend: queryEvents });
  const languageQuerySnapshots = languageQuerySnapshotStore.snapshot();
  const queuePressure = diagnostics?.queuePressure;
  const repairActions = diagnostics?.repairActions ?? [];
  const schemaRebuildActions = diagnostics?.schemaVersionActions.filter((action) => action.status === "needs-rebuild") ?? [];
  const layerStatusText = getLayerReadinessStatusText(layerReadiness);
  const activeProjectTask = buildActiveProjectTaskSummary(taskStatuses);
  const activeSdkTask = buildActiveSdkTaskSummary(taskStatuses);
  const activeTask = activeProjectTask ?? activeSdkTask;
  const viewModel = buildIndexDiagnosticsViewModel({
    diagnostics: diagnostics ? {
      status: diagnostics.status,
      fileCount: diagnostics.fileCount,
      dbSizeBytes: diagnostics.dbSizeBytes,
      timelineCount: diagnostics.timeline.length,
    } : null,
    layerStatusText,
    uiLatencyCount: uiLatencySamples.length,
    ipcLatencyCount: ipcLatencySamples.length,
    renderPressureCount: renderPressureSamples.length,
  });

  return (
    <div className="index-diagnostics-modal" role="presentation" onMouseDown={onClose}>
      <section
        className="index-diagnostics"
        role="dialog"
        aria-modal="true"
        aria-label="Index Diagnostics Center"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="index-diagnostics__header">
          <div>
            <h2>Index Diagnostics Center</h2>
            <p>{viewModel.headerStatusText}</p>
          </div>
          <div className="index-diagnostics__actions">
            <button type="button" className="toolbar__button" onClick={onRefresh}>Refresh</button>
            <button type="button" className="palette-shell__close" aria-label="Close Index Diagnostics" onClick={onClose}>x</button>
          </div>
        </header>

        <IndexDiagnosticsActiveTaskStrip task={activeTask} />

        <div className="index-diagnostics__body">
          <aside className="index-diagnostics__nav" aria-label="Index Diagnostics Sections">
            <a href="#index-diagnostics-processes">Processes</a>
            <a href="#index-diagnostics-current-file">Current File</a>
            <a href="#index-diagnostics-layers">Layers</a>
            <a href="#index-diagnostics-query-explain">Query Explain</a>
            <a href="#index-diagnostics-language-queries">Language Queries</a>
            <a href="#index-diagnostics-health">Health</a>
            <a href="#index-diagnostics-timeline">Timeline</a>
          </aside>

          <div className="index-diagnostics__content">
            {loading ? <div className="index-diagnostics__notice">Loading index diagnostics...</div> : null}

            <IndexDiagnosticsProcessesSection queuePressure={queuePressure} taskStatuses={taskStatuses} />

            <IndexDiagnosticsCurrentFileSection
              activePath={activePath}
              currentFileDirty={currentFileDirty}
              fileReadiness={fileReadiness}
            />

            <section className="index-diagnostics__section" id="index-diagnostics-layers" aria-label="Index Layers">
              <div className="index-diagnostics__section-title">
                <h3>Index Layers</h3>
                <span>{layerReadiness?.layers.length ?? 0} layers</span>
              </div>
              <div className="index-diagnostics__table">
                <div className="index-diagnostics__row index-diagnostics__row--header index-diagnostics__row--layers">
                  <span>Layer</span>
                  <span>Workspace</span>
                  <span>Current file</span>
                  <span>Counts</span>
                  <span>Action</span>
                </div>
                {(layerReadiness?.layers ?? []).length > 0 ? layerReadiness?.layers.map((layer) => (
                  <LayerReadinessRow layer={layer} key={layer.layer} />
                )) : (
                  <div className="index-diagnostics__empty">No layer readiness evidence is available.</div>
                )}
              </div>
            </section>

            <IndexDiagnosticsQueryExplainSection
              queryTimeline={queryTimeline}
              recentCount={queryEvents.length + recentQueryExplains.length}
            />

            <LanguageQuerySnapshotPanel id="index-diagnostics-language-queries" records={languageQuerySnapshots} />

            <IndexDiagnosticsHealthSection
              diagnostics={diagnostics}
              dbSize={viewModel.dbSize}
              schemaRebuildActions={schemaRebuildActions}
              repairActions={repairActions}
              activeProjectTask={activeProjectTask}
              activeSdkTask={activeSdkTask}
              onResumeIndexing={onResumeIndexing}
              onRebuildProjectIndex={onRebuildProjectIndex}
              onRebuildSdkIndex={onRebuildSdkIndex}
              onConfigureSdk={onConfigureSdk}
            />

            <section className="index-diagnostics__section" id="index-diagnostics-parser-errors" aria-label="Top Parser Errors">
              <div className="index-diagnostics__section-title">
                <h3>Top Parser Errors</h3>
                <span>{diagnostics?.parserFailures.length ?? 0} files</span>
              </div>
              {(diagnostics?.parserFailures ?? []).length > 0 ? diagnostics?.parserFailures.map((failure) => (
                <div className="index-diagnostics__event" key={`${failure.path}:${failure.line}:${failure.column}`}>
                  <span>{failure.path}:{failure.line}:{failure.column}</span>
                  <strong>{failure.message}</strong>
                </div>
              )) : (
                <div className="index-diagnostics__empty">No parser errors recorded.</div>
              )}
            </section>

            <section className="index-diagnostics__section" id="index-diagnostics-unresolved-imports" aria-label="Unresolved Imports">
              <div className="index-diagnostics__section-title">
                <h3>Unresolved Imports</h3>
                <span>{diagnostics?.unresolvedImports.length ?? 0} imports</span>
              </div>
              {(diagnostics?.unresolvedImports ?? []).length > 0 ? diagnostics?.unresolvedImports.map((item) => (
                <div className="index-diagnostics__event" key={`${item.fromPath}:${item.sourceModule}:${item.line}:${item.column}`}>
                  <span>{item.fromPath}:{item.line}:{item.column}</span>
                  <strong>{item.sourceModule}</strong>
                </div>
              )) : (
                <div className="index-diagnostics__empty">No unresolved imports recorded.</div>
              )}
            </section>

            <IndexDiagnosticsPerformanceTimelineSection
              timelineCount={viewModel.timelineCount}
              diagnosticsTimeline={diagnostics?.timeline ?? []}
              uiLatencySamples={uiLatencySamples}
              ipcLatencySamples={ipcLatencySamples}
              renderPressureSamples={renderPressureSamples}
            />
          </div>
        </div>
      </section>
    </div>
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
