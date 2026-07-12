import type { ActiveProjectTaskSummary } from "@/components/layout/index-diagnostics-model";

export function IndexDiagnosticsSdkTaskSummary({ task }: { task: ActiveProjectTaskSummary | null }) {
  if (!task) {
    return null;
  }

  return (
    <div
      className={`index-diagnostics__sdk-task index-diagnostics__sdk-task--${task.status}`}
      role="status"
      aria-label="SDK Index Task Summary"
    >
      <div>
        <span>SDK Index</span>
        <strong>{task.title}</strong>
      </div>
      <span>{task.progress}</span>
      <span>{task.duration}</span>
      <span>{task.detail || "No additional detail"}</span>
    </div>
  );
}
