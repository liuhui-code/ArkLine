import type { ActiveProjectTaskSummary } from "@/components/layout/index-diagnostics-model";

export function IndexDiagnosticsActiveTaskStrip({ task }: { task: ActiveProjectTaskSummary | null }) {
  if (!task) {
    return null;
  }

  return (
    <div
      className={`index-diagnostics__active-task index-diagnostics__active-task--${task.status}`}
      role="status"
      aria-label="Active Index Task"
    >
      <div>
        <strong>{task.title}</strong>
        <span>{task.detail}</span>
      </div>
      <span>{task.kind}</span>
      <span>{task.progress}</span>
      <span>{task.targetSummary ?? ""}</span>
      <span>{task.duration}</span>
    </div>
  );
}
