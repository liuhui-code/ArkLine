import type { WorkspaceIndexDiagnostics, WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";
import { IndexDiagnosticsMetric } from "@/components/layout/IndexDiagnosticsMetric";
import {
  formatTaskDetails,
  formatTaskDuration,
  formatTaskProgress,
  formatTaskTargets,
} from "@/components/layout/index-diagnostics-model";

type IndexDiagnosticsProcessesSectionProps = {
  queuePressure: WorkspaceIndexDiagnostics["queuePressure"] | undefined;
  taskStatuses: WorkspaceIndexTaskStatus[];
};

export function IndexDiagnosticsProcessesSection({
  queuePressure,
  taskStatuses,
}: IndexDiagnosticsProcessesSectionProps) {
  return (
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
        <div className="index-diagnostics__row index-diagnostics__row--header index-diagnostics__row--processes">
          <span>Task kind</span>
          <span>Status</span>
          <span>Progress</span>
          <span>Duration</span>
          <span>Target</span>
          <span>Details</span>
        </div>
        {taskStatuses.length > 0 ? taskStatuses.map((task) => (
          <div
            className={`index-diagnostics__row index-diagnostics__row--processes${task.stalled ? " index-diagnostics__row--stalled" : ""}`}
            key={task.taskId}
          >
            <span>{task.kind}</span>
            <span>{task.stalled ? "stalled" : task.status}</span>
            <span>{formatTaskProgress(task)}</span>
            <span>{formatTaskDuration(task)}</span>
            <span>{formatTaskTargets(task)}</span>
            <span>{formatTaskDetails(task)}</span>
          </div>
        )) : (
          <div className="index-diagnostics__empty">No running or queued index tasks.</div>
        )}
      </div>
    </section>
  );
}
