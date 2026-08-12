import {
  getWorkspacePartialNotice,
  getWorkspaceScanText,
} from "@/components/layout/app-shell-model";
import { LAZY_PROJECT_TREE_FILE_THRESHOLD } from "@/components/layout/app-shell-constants";
import { filterRecentFileResults, filterRecentProjectResults, getOverlayLabel } from "@/components/layout/search-overlay-model";
import type { OverlayKey } from "@/components/layout/shell-state";
import { describeSemanticCapabilities } from "@/features/semantic/semantic-capability-state";
import type { SemanticState } from "@/features/semantic/semantic-store";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { createWorkspaceIndexStore } from "@/features/workspace/workspace-index-store";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

type WorkspaceIndexStore = ReturnType<typeof createWorkspaceIndexStore>;
type SettingsApplyState = "idle" | "applying" | "applied" | "failed";

export type AppShellDerivedStateOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceIndex: WorkspaceIndexStore;
  workspaceIndexState: WorkspaceIndexState;
  workspaceIndexStatusSummary: {
    workspaceIndexText: string;
    sdkIndexText: string | null;
  };
  quickOpenQuery: string;
  persistentQuickOpenAvailable?: boolean;
  recentFiles: string[];
  recentProjects: string[];
  activeOverlay: OverlayKey;
  semanticState: SemanticState;
  settingsApplyState: SettingsApplyState;
};

export function getAppShellDerivedState({
  workspace,
  workspaceIndex,
  workspaceIndexState,
  workspaceIndexStatusSummary,
  quickOpenQuery,
  persistentQuickOpenAvailable = false,
  recentFiles,
  recentProjects,
  activeOverlay,
  semanticState,
  settingsApplyState,
}: AppShellDerivedStateOptions) {
  const queryReadinessNotice = workspaceIndexState.queryReadiness
    && workspaceIndexState.queryReadiness.state !== "ready"
    && workspaceIndexState.queryReadiness.state !== "missing"
    ? workspaceIndexState.queryReadiness.reason ?? `Index is ${workspaceIndexState.queryReadiness.state}; results may be incomplete.`
    : null;

  const quickOpenResults = activeOverlay === "quickOpen" && workspace && !persistentQuickOpenAvailable
    ? workspaceIndex.queryQuickOpen(quickOpenQuery, 8).flatMap((candidate) => candidate.path ? [{ path: candidate.path }] : [])
    : [];
  const recentFileResults = activeOverlay === "recentFiles"
    ? filterRecentFileResults(recentFiles.map((path) => ({
      path,
      title: getPathBasename(path),
      relativePath: getRelativeFilePath(path, workspace?.rootPath),
    })), quickOpenQuery)
    : [];
  const recentProjectResults = activeOverlay === "recentProjects"
    ? filterRecentProjectResults(recentProjects.map((path) => ({ path, name: getPathBasename(path) })), quickOpenQuery)
    : [];

  return {
    quickOpenResults,
    recentFileResults,
    recentProjectResults,
    overlayVisible: activeOverlay !== "none"
      && activeOverlay !== "completion"
      && activeOverlay !== "quickOpen"
      && activeOverlay !== "searchEverywhere",
    overlayLabel: activeOverlay === "none" ? "Quick Open" : getOverlayLabel(activeOverlay),
    semanticCapability: describeSemanticCapabilities(semanticState, settingsApplyState),
    useLazyProjectTree: Boolean(
      workspace
        && (workspace.scanSummary.truncated || workspace.visibleFiles.length >= LAZY_PROJECT_TREE_FILE_THRESHOLD),
    ),
    workspaceScanText: getWorkspaceScanText(workspace),
    workspaceIndexText: workspaceIndexStatusSummary.workspaceIndexText,
    sdkIndexText: workspaceIndexStatusSummary.sdkIndexText,
    workspacePartialNotice: queryReadinessNotice
      ?? workspaceIndexState.partialReason
      ?? getWorkspacePartialNotice(workspace),
  };
}

function getRelativeFilePath(path: string, rootPath: string | null | undefined) {
  const normalizedPath = normalizePath(path).replaceAll("\\", "/");
  const normalizedRoot = rootPath ? normalizePath(rootPath).replaceAll("\\", "/").replace(/\/+$/, "") : "";
  if (normalizedRoot && normalizedPath === normalizedRoot) {
    return getPathBasename(path);
  }
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }
  const segments = normalizedPath.split("/").filter(Boolean);
  return segments.length > 1 ? segments.slice(-2).join("/") : normalizedPath;
}
