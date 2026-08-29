import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";
import type { BuildState } from "@/features/build/build-model";
import { isLatestTaskGenerationForKind } from "@/features/workspace/workspace-index-task-reconciliation";

export type BackgroundTask = {
  id: string;
  title: string;
  detail: string;
  status: "queued" | "running";
  progress: { current: number; total: number } | null;
  cancellable: boolean;
  source: "index" | "build";
};

export function deriveBackgroundTasks(
  indexTasks: WorkspaceIndexTaskStatus[],
  buildState?: Pick<BuildState, "status" | "message">,
): BackgroundTask[] {
  const tasks: BackgroundTask[] = indexTasks
    .filter((task) => isActiveIndexTask(task, indexTasks))
    .map((task) => ({
      id: `index:${task.taskId}`,
      title: indexTaskTitle(task.kind),
      detail: indexTaskDetail(task),
      status: task.status === "queued" ? "queued" : "running",
      progress: hasMeasurableProgress(task)
        ? { current: task.progressCurrent, total: task.progressTotal }
        : null,
      cancellable: false,
      source: "index",
    }));

  if (buildState?.status === "planning" || buildState?.status === "running") {
    tasks.push({
      id: "build:current",
      title: "Building project",
      detail: buildState.message,
      status: buildState.status === "planning" ? "queued" : "running",
      progress: null,
      cancellable: true,
      source: "build",
    });
  }

  return tasks;
}

function isActiveIndexTask(task: WorkspaceIndexTaskStatus, tasks: WorkspaceIndexTaskStatus[]) {
  return task.status === "queued"
    || task.status === "running"
    || (
      task.kind === "discovery"
      && task.status === "partial"
      && isLatestTaskGenerationForKind(task, tasks)
    );
}

function hasMeasurableProgress(task: WorkspaceIndexTaskStatus) {
  return task.progressTotal > 0
    && !(task.progressCurrent === 0 && task.progressTotal === 1);
}

function indexTaskTitle(kind: string) {
  switch (kind) {
    case "open-workspace":
      return "Indexing project";
    case "refresh-workspace":
      return "Refreshing project index";
    case "changed-paths":
      return "Indexing file changes";
    case "discovery":
      return "Discovering project files";
    case "sdk":
      return "Indexing SDK APIs";
    case "definition":
    case "completion":
    case "foreground-navigation":
      return "Indexing current file";
    default:
      return "Updating project index";
  }
}

function indexTaskDetail(task: WorkspaceIndexTaskStatus) {
  if (hasMeasurableProgress(task)) {
    const unit = task.reason.startsWith("full-refresh-deep:")
      ? "indexing steps"
      : "files";
    return `${task.progressCurrent.toLocaleString()} of ${task.progressTotal.toLocaleString()} ${unit}`;
  }
  return task.message ?? task.reason;
}
