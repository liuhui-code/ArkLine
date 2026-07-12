import type { ActiveProjectTaskSummary } from "@/components/layout/index-diagnostics-model";

type IndexDiagnosticsHealthTaskSummaryProps = {
  task: ActiveProjectTaskSummary | null;
  label: string;
  ariaLabel: string;
};

export function IndexDiagnosticsHealthTaskSummary({
  task,
  label,
  ariaLabel,
}: IndexDiagnosticsHealthTaskSummaryProps) {
  if (!task) {
    return null;
  }

  return (
    <div
      className={`index-diagnostics__health-task index-diagnostics__health-task--${task.status}`}
      role="status"
      aria-label={ariaLabel}
    >
      <div>
        <span>{label}</span>
        <strong>{task.title}</strong>
      </div>
      <span>{task.progress}</span>
      <span>{task.duration}</span>
      <span>{task.detail || "No additional detail"}</span>
    </div>
  );
}
