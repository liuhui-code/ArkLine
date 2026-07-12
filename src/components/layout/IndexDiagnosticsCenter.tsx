import { useEffect } from "react";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
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
import {
  IndexDiagnosticsParserErrorsSection,
  IndexDiagnosticsUnresolvedImportsSection,
} from "@/components/layout/IndexDiagnosticsEvidenceSections";
import { IndexDiagnosticsHealthSection } from "@/components/layout/IndexDiagnosticsHealthSection";
import { IndexDiagnosticsLayersSection } from "@/components/layout/IndexDiagnosticsLayersSection";
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
  onIndexCurrentFile?: () => void;
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
  onIndexCurrentFile,
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
  const activeProjectTask = buildActiveProjectTaskSummary(taskStatuses, activePath);
  const activeSdkTask = buildActiveSdkTaskSummary(taskStatuses, activePath);
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

  function runLayerAction(action: string) {
    if (action === "configureSdk") {
      onConfigureSdk();
      return;
    }
    if (action === "rebuildIndex") {
      onRebuildProjectIndex();
      return;
    }
    if (action === "indexCurrentFile") {
      onIndexCurrentFile?.();
      return;
    }
    if (action === "inspectParserFailures") {
      document.getElementById("index-diagnostics-parser-errors")?.scrollIntoView({ block: "start" });
      return;
    }
    if (action === "rebuildSdkIndex") {
      onRebuildSdkIndex();
    }
  }

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

            <IndexDiagnosticsLayersSection
              layerReadiness={layerReadiness}
              taskStatuses={taskStatuses}
              onAction={runLayerAction}
            />

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

            <IndexDiagnosticsParserErrorsSection parserFailures={diagnostics?.parserFailures ?? []} />

            <IndexDiagnosticsUnresolvedImportsSection unresolvedImports={diagnostics?.unresolvedImports ?? []} />

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
