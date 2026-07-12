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
  formatClockTime,
  formatLayerCounts,
  formatRepairAction,
  formatTaskDetails,
  formatTaskDuration,
  formatTaskProgress,
} from "@/components/layout/index-diagnostics-model";
import {
  buildQueryExplainTimeline,
  type QueryEnvelopeExplainSummary,
  type RecentQueryExplain,
} from "@/features/workspace/workspace-query-explain-model";
import type { UiLatencySample } from "@/features/performance/ui-latency-monitor";
import type { IpcLatencySample } from "@/features/performance/ipc-latency-store";
import type { RenderPressureSample } from "@/features/performance/render-pressure-store";
import { LanguageQuerySnapshotPanel } from "@/components/layout/LanguageQuerySnapshotPanel";
import { IndexDiagnosticsActiveTaskStrip } from "@/components/layout/IndexDiagnosticsActiveTaskStrip";
import { IndexDiagnosticsCurrentFileSection } from "@/components/layout/IndexDiagnosticsCurrentFileSection";
import { IndexDiagnosticsHealthTaskSummary } from "@/components/layout/IndexDiagnosticsHealthTaskSummary";
import { IndexDiagnosticsMetric } from "@/components/layout/IndexDiagnosticsMetric";
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

            <section className="index-diagnostics__section" id="index-diagnostics-processes" aria-label="Processes / Queue">
              <div className="index-diagnostics__section-title">
                <h3>Processes / Queue</h3>
                <span>{queuePressure?.pendingTaskCount ?? taskStatuses.length} pending</span>
              </div>
              <div className="index-diagnostics__grid">
                <IndexDiagnosticsMetric label="Pending total" value={String(queuePressure?.pendingTaskCount ?? 0)} />
                <IndexDiagnosticsMetric label="Workspace pending" value={String(queuePressure?.workspacePendingTaskCount ?? 0)} />
                <IndexDiagnosticsMetric label="Top priority" value={queuePressure?.highestPriority ?? "none"} />
                <IndexDiagnosticsMetric label="Top task" value={queuePressure?.highestPriorityTaskKind ?? "none"} />
              </div>
              <div className="index-diagnostics__table">
                <div className="index-diagnostics__row index-diagnostics__row--header">
                  <span>Task kind</span>
                  <span>Status</span>
                  <span>Progress</span>
                  <span>Duration</span>
                  <span>Details</span>
                </div>
                {taskStatuses.length > 0 ? taskStatuses.map((task) => (
                  <div
                    className={`index-diagnostics__row${task.stalled ? " index-diagnostics__row--stalled" : ""}`}
                    key={task.taskId}
                  >
                    <span>{task.kind}</span>
                    <span>{task.stalled ? "stalled" : task.status}</span>
                    <span>{formatTaskProgress(task)}</span>
                    <span>{formatTaskDuration(task)}</span>
                    <span>{formatTaskDetails(task)}</span>
                  </div>
                )) : (
                  <div className="index-diagnostics__empty">No running or queued index tasks.</div>
                )}
              </div>
            </section>

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

            <section className="index-diagnostics__section" id="index-diagnostics-query-explain" aria-label="Query Explain">
              <div className="index-diagnostics__section-title">
                <h3>Query Explain</h3>
                <span>{queryEvents.length + recentQueryExplains.length} recent</span>
              </div>
              {queryTimeline.length > 0 ? queryTimeline.map((event) => (
                <div className="index-diagnostics__event" key={event.id}>
                  <span>{event.title}</span>
                  <span>{event.displayTime}</span>
                  <strong>{event.message}</strong>
                  <QueryExplainSummary summary={event.summary} />
                  <code>{event.raw}</code>
                </div>
              )) : null}
              {queryTimeline.length === 0 ? (
                <div className="index-diagnostics__empty">No query explain events yet.</div>
              ) : null}
            </section>

            <LanguageQuerySnapshotPanel id="index-diagnostics-language-queries" records={languageQuerySnapshots} />

            <section className="index-diagnostics__section" id="index-diagnostics-health" aria-label="Health / Storage">
              <div className="index-diagnostics__section-title">
                <h3>Health / Storage</h3>
                <span>{diagnostics?.rootPath ?? "No workspace"}</span>
              </div>
              <div className="index-diagnostics__grid">
                <IndexDiagnosticsMetric label="Schema domains" value={String(Object.keys(diagnostics?.schemaVersions ?? {}).length)} />
                <IndexDiagnosticsMetric label="Symbols" value={String(diagnostics?.symbolCount ?? 0)} />
                <IndexDiagnosticsMetric label="Text rows" value={String(diagnostics?.contentLineCount ?? 0)} />
                <IndexDiagnosticsMetric label="SDK symbols" value={String(diagnostics?.sdkSymbolCount ?? 0)} />
                <IndexDiagnosticsMetric label="Discovery" value={diagnostics?.discoveryStatus ?? "none"} />
                <IndexDiagnosticsMetric label="Discovered files" value={(diagnostics?.discoveredFileCount ?? 0).toLocaleString()} />
                <IndexDiagnosticsMetric label="Excluded entries" value={(diagnostics?.discoveryExcludedCount ?? 0).toLocaleString()} />
                <IndexDiagnosticsMetric label="Discovery cursor" value={diagnostics?.discoveryHasMore ? "has more" : "complete"} />
                <IndexDiagnosticsMetric label="Stale files" value={String(diagnostics?.staleGenerationCount ?? 0)} />
                <IndexDiagnosticsMetric label="Parser errors" value={String(diagnostics?.parserErrorCount ?? 0)} />
                <IndexDiagnosticsMetric label="DB size" value={viewModel.dbSize} />
                <IndexDiagnosticsMetric label="Last explain" value={diagnostics?.lastExplainStatus ?? "none"} />
                <IndexDiagnosticsMetric label="Last error" value={diagnostics?.lastError ?? "none"} />
              </div>
              <IndexDiagnosticsHealthTaskSummary
                task={activeProjectTask}
                label="Project Index"
                ariaLabel="Project Index Task Summary"
              />
              <IndexDiagnosticsHealthTaskSummary
                task={activeSdkTask}
                label="SDK Index"
                ariaLabel="SDK Index Task Summary"
              />
              {schemaRebuildActions.length > 0 ? (
                <div className="index-diagnostics__table" aria-label="Schema Rebuild Required">
                  <div className="index-diagnostics__row index-diagnostics__row--header index-diagnostics__row--schema">
                    <span>Schema Rebuild Required</span>
                    <span>Persisted</span>
                    <span>Expected</span>
                  </div>
                  {schemaRebuildActions.map((action) => (
                    <div className="index-diagnostics__row index-diagnostics__row--schema" key={action.domain}>
                      <span>{action.domain}</span>
                      <span>{action.persistedVersion ?? "missing"}</span>
                      <span>{`${action.persistedVersion ?? "missing"} -> ${action.expectedVersion}`}</span>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="index-diagnostics__repair-actions" aria-label="Repair Actions">
                {repairActions.length > 0 ? repairActions.map((action) => (
                  action === "resumeIndexing" ? (
                    <button type="button" className="toolbar__button" key={action} onClick={onResumeIndexing}>
                      Resume Indexing
                    </button>
                  ) : action === "rebuildProjectIndex" ? (
                    <span className="index-diagnostics__repair-running" key={action}>
                      <button type="button" className="toolbar__button" disabled={Boolean(activeProjectTask)} onClick={onRebuildProjectIndex}>
                        {activeProjectTask ? "Running Project Index" : "Rebuild Project Index"}
                      </button>
                      {activeProjectTask ? <span>{activeProjectTask.progress}</span> : null}
                    </span>
                  ) : action === "rebuildSdkIndex" ? (
                    <span className="index-diagnostics__repair-running" key={action}>
                      <button type="button" className="toolbar__button" disabled={Boolean(activeSdkTask)} onClick={onRebuildSdkIndex}>
                        {activeSdkTask ? "Running SDK Index" : "Rebuild SDK Index"}
                      </button>
                      {activeSdkTask ? <span>{activeSdkTask.progress}</span> : null}
                    </span>
                  ) : action === "configureSdk" ? (
                    <button type="button" className="toolbar__button" key={action} onClick={onConfigureSdk}>
                      Configure SDK
                    </button>
                  ) : (
                    <span className="index-diagnostics__chip" key={action}>{formatRepairAction(action)}</span>
                  )
                )) : (
                  <span className="index-diagnostics__empty">No repair action suggested.</span>
                )}
              </div>
            </section>

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

            <section className="index-diagnostics__section" id="index-diagnostics-timeline" aria-label="Performance Timeline">
              <div className="index-diagnostics__section-title">
                <h3>Performance Timeline</h3>
                <span>{viewModel.timelineCount} events</span>
              </div>
              <div className="index-diagnostics__timeline">
                {renderPressureSamples.map((item) => (
                  <div className="index-diagnostics__timeline-item" key={`render:${item.label}`}>
                    <span className="index-diagnostics__severity index-diagnostics__severity--info">render</span>
                    <div>
                      <strong>{item.label}</strong>
                      <span>{item.count.toLocaleString()} renders</span>
                    </div>
                    <span>{formatClockTime(item.lastRenderedAt)}</span>
                  </div>
                ))}
                {ipcLatencySamples.map((item, index) => (
                  <div className="index-diagnostics__timeline-item" key={`ipc:${item.command}:${item.startedAt}:${index}`}>
                    <span className={`index-diagnostics__severity index-diagnostics__severity--${item.status === "error" ? "error" : "info"}`}>ipc</span>
                    <div>
                      <strong>{item.command}</strong>
                      <span>{item.status}</span>
                    </div>
                    <span>{item.durationMs}ms</span>
                  </div>
                ))}
                {uiLatencySamples.map((item, index) => (
                  <div className="index-diagnostics__timeline-item" key={`${item.kind}:${item.startedAt}:${index}`}>
                    <span className="index-diagnostics__severity index-diagnostics__severity--warning">ui</span>
                    <div>
                      <strong>UI responsiveness</strong>
                      <span>{item.kind} · {item.label}</span>
                    </div>
                    <span>{item.durationMs}ms</span>
                  </div>
                ))}
                {(diagnostics?.timeline ?? []).length > 0 ? diagnostics?.timeline.map((item, index) => (
                  <div className="index-diagnostics__timeline-item" key={`${item.taskId ?? item.title}:${item.occurredAt}:${index}`}>
                    <span className={`index-diagnostics__severity index-diagnostics__severity--${item.severity}`}>{item.severity}</span>
                    <div>
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                    </div>
                    <span>{item.durationMs == null ? "start" : `${item.durationMs}ms`}</span>
                  </div>
                )) : null}
                {viewModel.timelineCount === 0 ? (
                  <div className="index-diagnostics__empty">No timeline events yet.</div>
                ) : null}
              </div>
            </section>
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

function QueryExplainSummary({ summary }: { summary: QueryEnvelopeExplainSummary | null }) {
  if (!summary) {
    return null;
  }
  const rows = [
    ["Action", summary.action],
    ["Used", summary.used],
    ["Skipped", summary.skipped],
    ["Readiness", summary.readiness],
    ["Result count", summary.resultCount],
    ["Generation", summary.generation],
    ["Retryable", summary.retryable],
  ].filter((row): row is [string, string] => Boolean(row[1]));

  if (rows.length === 0) {
    return null;
  }

  return (
    <dl className="index-diagnostics__explain-summary" aria-label="Query explain evidence">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
