import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";
import type { ActiveProjectTaskSummary } from "@/components/layout/index-diagnostics-model";
import { formatRepairAction } from "@/components/layout/index-diagnostics-model";
import { IndexDiagnosticsHealthTaskSummary } from "@/components/layout/IndexDiagnosticsHealthTaskSummary";
import { IndexDiagnosticsMetric } from "@/components/layout/IndexDiagnosticsMetric";

type IndexDiagnosticsHealthSectionProps = {
  diagnostics: WorkspaceIndexDiagnostics | null;
  dbSize: string;
  schemaRebuildActions: WorkspaceIndexDiagnostics["schemaVersionActions"];
  repairActions: string[];
  activeProjectTask: ActiveProjectTaskSummary | null;
  activeSdkTask: ActiveProjectTaskSummary | null;
  onResumeIndexing: () => void;
  onRebuildProjectIndex: () => void;
  onRebuildSdkIndex: () => void;
  onConfigureSdk: () => void;
};

export function IndexDiagnosticsHealthSection({
  diagnostics,
  dbSize,
  schemaRebuildActions,
  repairActions,
  activeProjectTask,
  activeSdkTask,
  onResumeIndexing,
  onRebuildProjectIndex,
  onRebuildSdkIndex,
  onConfigureSdk,
}: IndexDiagnosticsHealthSectionProps) {
  return (
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
        <IndexDiagnosticsMetric label="DB size" value={dbSize} />
        <IndexDiagnosticsMetric label="Last explain" value={diagnostics?.lastExplainStatus ?? "none"} />
        <IndexDiagnosticsMetric
          label="Retry backoff"
          value={diagnostics?.latestRetryBackoff ?? (diagnostics?.retryBackoffCount ? `${diagnostics.retryBackoffCount} active` : "none")}
        />
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
  );
}
