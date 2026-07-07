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
  buildQueryExplainTimeline,
  type QueryEnvelopeExplainSummary,
  type RecentQueryExplain,
} from "@/features/workspace/workspace-query-explain-model";
import type { UiLatencySample } from "@/features/performance/ui-latency-monitor";
import "./index-diagnostics-center.css";

type IndexDiagnosticsCenterProps = {
  open: boolean;
  loading: boolean;
  activePath: string | null;
  currentFileDirty: boolean;
  diagnostics: WorkspaceIndexDiagnostics | null;
  fileReadiness: WorkspaceIndexFileReadiness | null;
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
  recentQueryExplains: RecentQueryExplain[];
  taskStatuses: WorkspaceIndexTaskStatus[];
  uiLatencySamples?: UiLatencySample[];
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
  activePath,
  currentFileDirty,
  diagnostics,
  fileReadiness,
  layerReadiness,
  recentQueryExplains,
  taskStatuses,
  uiLatencySamples = [],
  onClose,
  onRefresh,
  onResumeIndexing,
  onRebuildProjectIndex,
  onRebuildSdkIndex,
  onConfigureSdk,
}: IndexDiagnosticsCenterProps) {
  if (!open) {
    return null;
  }

  const queryEvents = diagnostics?.recentEvents.filter((event) => event.scope === "query") ?? [];
  const queryTimeline = buildQueryExplainTimeline({ frontend: recentQueryExplains, backend: queryEvents });
  const dbSize = formatBytes(diagnostics?.dbSizeBytes ?? 0);
  const queuePressure = diagnostics?.queuePressure;
  const repairActions = diagnostics?.repairActions ?? [];
  const layerStatusText = getLayerReadinessStatusText(layerReadiness);
  const headerStatusText = layerStatusText
    ?? (diagnostics ? `${diagnostics.status} · ${diagnostics.fileCount.toLocaleString()} files` : "Workspace index evidence");

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
            <p>{headerStatusText}</p>
          </div>
          <div className="index-diagnostics__actions">
            <button type="button" className="toolbar__button" onClick={onRefresh}>Refresh</button>
            <button type="button" className="palette-shell__close" aria-label="Close Index Diagnostics" onClick={onClose}>x</button>
          </div>
        </header>

        <div className="index-diagnostics__body">
          <aside className="index-diagnostics__nav" aria-label="Index Diagnostics Sections">
            <span>Processes</span>
            <span>Current File</span>
            <span>Layers</span>
            <span>Query Explain</span>
            <span>Health</span>
            <span>Timeline</span>
          </aside>

          <div className="index-diagnostics__content">
            {loading ? <div className="index-diagnostics__notice">Loading index diagnostics...</div> : null}

            <section className="index-diagnostics__section" aria-label="Processes / Queue">
              <div className="index-diagnostics__section-title">
                <h3>Processes / Queue</h3>
                <span>{queuePressure?.pendingTaskCount ?? taskStatuses.length} pending</span>
              </div>
              <div className="index-diagnostics__grid">
                <Metric label="Pending total" value={String(queuePressure?.pendingTaskCount ?? 0)} />
                <Metric label="Workspace pending" value={String(queuePressure?.workspacePendingTaskCount ?? 0)} />
                <Metric label="Top priority" value={queuePressure?.highestPriority ?? "none"} />
                <Metric label="Top task" value={queuePressure?.highestPriorityTaskKind ?? "none"} />
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

            <section className="index-diagnostics__section" aria-label="Current File Readiness">
              <div className="index-diagnostics__section-title">
                <h3>Current File Readiness</h3>
                <span>{fileReadiness?.fileName ?? activePath ?? "No file"}</span>
              </div>
              <p className="index-diagnostics__reason">
                {fileReadiness?.reason ?? "No current file readiness evidence is available."}
              </p>
              <div className="index-diagnostics__grid">
                <Metric label="Discovery" value={fileReadiness?.discoveryIndex ?? "unknown"} />
                <Metric label="FileIndex" value={fileReadiness?.fileIndex ?? "unknown"} />
                <Metric label="ContentIndex" value={fileReadiness?.contentIndex ?? "unknown"} />
                <Metric label="SymbolIndex" value={fileReadiness?.symbolIndex ?? "unknown"} />
                <Metric label="Parser" value={fileReadiness?.parserStatus ?? "unknown"} />
                <Metric label="Generation" value={String(fileReadiness?.indexedGeneration ?? "none")} />
                <Metric label="Editor dirty" value={currentFileDirty ? "newer than index" : "clean"} />
                <Metric label="Ctrl+Click" value={fileReadiness?.definitionAvailable ? "available" : "blocked"} />
                <Metric label="Completion" value={fileReadiness?.completionAvailable ? "available" : "blocked"} />
                <Metric label="Usages" value={fileReadiness?.usagesAvailable ? "available" : "blocked"} />
                <Metric label="Search" value={fileReadiness?.searchAvailable ? "available" : "blocked"} />
              </div>
            </section>

            <section className="index-diagnostics__section" aria-label="Index Layers">
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

            <section className="index-diagnostics__section" aria-label="Query Explain">
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

            <section className="index-diagnostics__section" aria-label="Health / Storage">
              <div className="index-diagnostics__section-title">
                <h3>Health / Storage</h3>
                <span>{diagnostics?.rootPath ?? "No workspace"}</span>
              </div>
              <div className="index-diagnostics__grid">
                <Metric label="Schema domains" value={String(Object.keys(diagnostics?.schemaVersions ?? {}).length)} />
                <Metric label="Symbols" value={String(diagnostics?.symbolCount ?? 0)} />
                <Metric label="Text rows" value={String(diagnostics?.contentLineCount ?? 0)} />
                <Metric label="SDK symbols" value={String(diagnostics?.sdkSymbolCount ?? 0)} />
                <Metric label="Discovery" value={diagnostics?.discoveryStatus ?? "none"} />
                <Metric label="Discovered files" value={(diagnostics?.discoveredFileCount ?? 0).toLocaleString()} />
                <Metric label="Excluded entries" value={(diagnostics?.discoveryExcludedCount ?? 0).toLocaleString()} />
                <Metric label="Discovery cursor" value={diagnostics?.discoveryHasMore ? "has more" : "complete"} />
                <Metric label="Stale files" value={String(diagnostics?.staleGenerationCount ?? 0)} />
                <Metric label="Parser errors" value={String(diagnostics?.parserErrorCount ?? 0)} />
                <Metric label="DB size" value={dbSize} />
                <Metric label="Last explain" value={diagnostics?.lastExplainStatus ?? "none"} />
                <Metric label="Last error" value={diagnostics?.lastError ?? "none"} />
              </div>
              <div className="index-diagnostics__repair-actions" aria-label="Repair Actions">
                {repairActions.length > 0 ? repairActions.map((action) => (
                  action === "resumeIndexing" ? (
                    <button type="button" className="toolbar__button" key={action} onClick={onResumeIndexing}>
                      Resume Indexing
                    </button>
                  ) : action === "rebuildProjectIndex" ? (
                    <button type="button" className="toolbar__button" key={action} onClick={onRebuildProjectIndex}>
                      Rebuild Project Index
                    </button>
                  ) : action === "rebuildSdkIndex" ? (
                    <button type="button" className="toolbar__button" key={action} onClick={onRebuildSdkIndex}>
                      Rebuild SDK Index
                    </button>
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

            <section className="index-diagnostics__section" aria-label="Top Parser Errors">
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

            <section className="index-diagnostics__section" aria-label="Unresolved Imports">
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

            <section className="index-diagnostics__section" aria-label="Performance Timeline">
              <div className="index-diagnostics__section-title">
                <h3>Performance Timeline</h3>
                <span>{(diagnostics?.timeline.length ?? 0) + uiLatencySamples.length} events</span>
              </div>
              <div className="index-diagnostics__timeline">
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
                {(diagnostics?.timeline ?? []).length === 0 && uiLatencySamples.length === 0 ? (
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

function formatLayerCounts(layer: WorkspaceIndexLayerReadiness) {
  return `${layer.indexedCount.toLocaleString()} indexed · ${layer.failedCount.toLocaleString()} failed · ${layer.staleCount.toLocaleString()} stale`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="index-diagnostics__metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.ceil(bytes / 1024).toLocaleString()} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTaskProgress(task: WorkspaceIndexTaskStatus) {
  const total = task.progressTotal;
  const current = task.progressCurrent;
  if (total <= 0) {
    return `${current}/${total}`;
  }
  const percentage = Math.max(0, Math.min(100, Math.round((current / total) * 100)));
  return `${current}/${total} (${percentage}%)`;
}

function formatTaskDuration(task: WorkspaceIndexTaskStatus) {
  const startedAt = task.startedAt;
  if (startedAt == null) {
    return "not started";
  }
  if (task.finishedAt != null) {
    return `${formatDurationMs(task.finishedAt - startedAt)} total`;
  }
  if (task.lastHeartbeatAt != null) {
    return `${formatDurationMs(task.lastHeartbeatAt - startedAt)} active`;
  }
  return "started";
}

function formatTaskDetails(task: WorkspaceIndexTaskStatus) {
  const detail = task.error ?? task.message ?? task.reason;
  if (!task.stalled) {
    return detail;
  }
  if (detail.toLowerCase().includes("no heartbeat")) {
    return "No heartbeat > 60s";
  }
  return detail ? `${detail} · No heartbeat > 60s` : "No heartbeat > 60s";
}

function formatDurationMs(durationMs: number) {
  const clampedMs = Math.max(0, durationMs);
  if (clampedMs < 1000) {
    return `${clampedMs}ms`;
  }
  if (clampedMs < 60_000) {
    return `${(clampedMs / 1000).toFixed(1)}s`;
  }
  return `${Math.floor(clampedMs / 60_000)}m ${Math.floor((clampedMs % 60_000) / 1000)}s`;
}

function formatRepairAction(action: string) {
  switch (action) {
    case "rebuildProjectIndex":
      return "Rebuild Project Index";
    case "rebuildSdkIndex":
      return "Rebuild SDK Index";
    case "configureSdk":
      return "Configure SDK";
    case "inspectUnresolvedImports":
      return "Inspect Unresolved Imports";
    case "inspectParserFailures":
      return "Inspect Parser Failures";
    default:
      return action;
  }
}
