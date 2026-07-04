import {
  COMPLETION_POPUP_FALLBACK_POSITION,
  COMPLETION_POPUP_GAP,
  COMPLETION_POPUP_HEIGHT,
  COMPLETION_POPUP_MARGIN,
  COMPLETION_POPUP_WIDTH,
} from "@/components/layout/app-shell-constants";
import type { CodeAction } from "@/features/code-actions/code-action-model";
import type { WorkspaceIndexTaskStatus, WorkspaceViewModel, WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type { SearchCandidate, WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { normalizePath } from "@/features/workspace/workspace-store";
import type { EditorCaretRect } from "@/editor/editor-events";

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function actionMatchesSource(action: CodeAction, source: "all" | "rename" | "generate" | "refactor") {
  if (source === "all") {
    return true;
  }

  const searchable = `${action.id} ${action.title} ${action.kind}`.toLowerCase();
  if (source === "rename") {
    return searchable.includes("rename");
  }
  if (source === "generate") {
    return searchable.includes("generate") || action.kind === "source";
  }

  return action.kind.startsWith("refactor")
    || searchable.includes("refactor")
    || searchable.includes("extract")
    || searchable.includes("inline");
}

export function uniqueNormalizedPaths(paths: string[]) {
  return [...new Set(paths.map(normalizePath))].sort((left, right) => left.localeCompare(right));
}

export function pathWithinDirectory(path: string, directoryPath: string) {
  const normalizedPath = normalizePath(path);
  const normalizedDirectory = normalizePath(directoryPath).replace(/[\\/]+$/g, "");
  const separator = normalizedDirectory.includes("\\") ? "\\" : "/";
  return normalizedPath === normalizedDirectory || normalizedPath.startsWith(`${normalizedDirectory}${separator}`);
}

export function replaceDirectoryPrefix(path: string, oldDirectoryPath: string, newDirectoryPath: string) {
  const normalizedPath = normalizePath(path);
  const normalizedOld = normalizePath(oldDirectoryPath).replace(/[\\/]+$/g, "");
  const normalizedNew = normalizePath(newDirectoryPath).replace(/[\\/]+$/g, "");
  return `${normalizedNew}${normalizedPath.slice(normalizedOld.length)}`;
}

export function constrainCompletionPopupPosition(top: number, left: number) {
  if (typeof window === "undefined") {
    return { top, left };
  }

  const maxLeft = window.innerWidth - COMPLETION_POPUP_WIDTH - COMPLETION_POPUP_MARGIN;
  return {
    top: Math.max(COMPLETION_POPUP_MARGIN, top),
    left: clampNumber(left, COMPLETION_POPUP_MARGIN, maxLeft),
  };
}

export function getCompletionPopupPosition(anchor: EditorCaretRect | null) {
  if (!anchor?.measured) {
    return constrainCompletionPopupPosition(COMPLETION_POPUP_FALLBACK_POSITION.top, COMPLETION_POPUP_FALLBACK_POSITION.left);
  }

  if (typeof window === "undefined") {
    return { top: anchor.bottom + COMPLETION_POPUP_GAP, left: anchor.left };
  }

  const belowTop = anchor.bottom + COMPLETION_POPUP_GAP;
  const hasSpaceBelow = belowTop + COMPLETION_POPUP_HEIGHT + COMPLETION_POPUP_MARGIN <= window.innerHeight;
  const preferredTop = hasSpaceBelow ? belowTop : anchor.top - COMPLETION_POPUP_HEIGHT - COMPLETION_POPUP_GAP;

  return constrainCompletionPopupPosition(preferredTop, anchor.left);
}

export function getWorkspaceScanText(workspace: WorkspaceViewModel | null) {
  if (!workspace) {
    return null;
  }

  return workspace.scanSummary.truncated
    ? `Workspace: partial (${workspace.visibleFiles.length.toLocaleString()} files)`
    : `Workspace: ready (${workspace.visibleFiles.length.toLocaleString()} files)`;
}

export function getWorkspacePartialNotice(workspace: WorkspaceViewModel | null) {
  if (!workspace?.scanSummary.truncated) {
    return null;
  }

  return `Partial workspace results: scan stopped at ${workspace.scanSummary.scannedFiles.toLocaleString()} files; excluded ${workspace.scanSummary.skippedEntries.toLocaleString()} generated/dependency entries.`;
}

export function getIndexStatusText(indexState: WorkspaceIndexState, taskStatuses: WorkspaceIndexTaskStatus[] = []) {
  const stalledTasks = taskStatuses.filter((status) => status.kind !== "sdk" && status.stalled);
  if (stalledTasks.length > 0) {
    const suffix = stalledTasks.length === 1 ? "task" : "tasks";
    return `Index: Stalled, ${stalledTasks.length} ${suffix} > 60s`;
  }

  const activeTask = getActiveProjectIndexTaskStatus(taskStatuses);
  if (activeTask) {
    const progressText = activeTask.progressTotal > 0
      ? ` (${activeTask.progressCurrent}/${activeTask.progressTotal})`
      : "";
    return `Index: ${activeTask.status} ${projectIndexTaskLabel(activeTask.kind)}${progressText}`;
  }

  if (indexState.status === "empty") {
    return "Index: empty";
  }

  if (indexState.status === "partial" && indexState.filePaths.length === 0) {
    return "Index: building project";
  }

  return `Index: ${indexState.status} (${indexState.filePaths.length.toLocaleString()} files)`;
}

export function getActiveProjectIndexTaskStatus(statuses: WorkspaceIndexTaskStatus[]) {
  return [...statuses]
    .reverse()
    .find((status) => status.kind !== "sdk" && (status.status === "queued" || status.status === "running"));
}

export function projectIndexTaskLabel(kind: string) {
  if (kind === "open-workspace") {
    return "project";
  }
  if (kind === "refresh-workspace") {
    return "refresh";
  }
  if (kind === "changed-paths") {
    return "changes";
  }
  return kind;
}

export function getSdkIndexStatusText(statuses: WorkspaceIndexTaskStatus[]) {
  const sdkStatus = [...statuses].reverse().find((status) => status.kind === "sdk");
  if (!sdkStatus) {
    return null;
  }

  const symbolText = sdkStatus.symbolCount == null
    ? ""
    : ` (${sdkStatus.symbolCount.toLocaleString()} symbols)`;
  return `SDK API: ${sdkStatus.status}${symbolText}`;
}

export function mergeWorkspaceIndexTaskStatus(
  statuses: WorkspaceIndexTaskStatus[],
  next: WorkspaceIndexTaskStatus,
) {
  const retained = statuses.filter((status) => status.taskId !== next.taskId);
  return [...retained, next].sort((left, right) => left.generation - right.generation);
}

export function filterSearchCandidatesByScope(candidates: SearchCandidate[], scope: WorkspaceIndexQueryScope) {
  if (scope === "all") {
    return candidates;
  }

  const sourceByScope: Partial<Record<WorkspaceIndexQueryScope, SearchCandidate["source"]>> = {
    files: "file",
    classes: "class",
    symbols: "symbol",
    api: "api",
  };
  const source = sourceByScope[scope];
  return source ? candidates.filter((candidate) => candidate.source === source) : candidates;
}

export function searchEverywhereEntityCandidates(candidates: SearchCandidate[]) {
  return candidates.filter((candidate) => candidate.source !== "text");
}
