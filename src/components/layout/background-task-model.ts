import type { WorkspaceIndexTaskStatus } from "@/features/workspace/workspace-api";
import type { BuildState } from "@/features/build/build-model";

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
    .filter(isActiveIndexTask)
    .map((task) => ({
      id: `index:${task.taskId}`,
      title: indexTaskTitle(task.kind),
      detail: indexTaskDetail(task),
      status: task.status === "queued" ? "queued" : "running",
      progress: task.progressTotal > 0
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

function isActiveIndexTask(task: WorkspaceIndexTaskStatus) {
  return task.status === "queued"
    || task.status === "running"
    || (task.kind === "discovery" && task.status === "partial");
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
  if (task.progressTotal > 0) {
    return `${task.progressCurrent.toLocaleString()} of ${task.progressTotal.toLocaleString()} files`;
  }
  return task.message ?? task.reason;
}
