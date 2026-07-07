import {
  getIndexStatusText,
  getLayerReadinessStatusText,
  getSdkIndexStatusText,
  getWorkspacePartialNotice,
  getWorkspaceScanText,
} from "@/components/layout/app-shell-model";
import { LAZY_PROJECT_TREE_FILE_THRESHOLD } from "@/components/layout/app-shell-constants";
import { filterRecentFileResults, filterRecentProjectResults, getOverlayLabel } from "@/components/layout/search-overlay-model";
import { searchOverlayLabel } from "@/components/layout/use-search-everywhere-controller";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { describeSemanticCapabilities } from "@/features/semantic/semantic-capability-state";
import type { SemanticState } from "@/features/semantic/semantic-store";
import type {
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";
import type { WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import { createWorkspaceIndexStore } from "@/features/workspace/workspace-index-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

type WorkspaceIndexStore = ReturnType<typeof createWorkspaceIndexStore>;
type SettingsApplyState = "idle" | "applying" | "applied" | "failed";

export type AppShellDerivedStateOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceIndex: WorkspaceIndexStore;
  workspaceIndexState: WorkspaceIndexState;
  workspaceIndexTaskStatuses: WorkspaceIndexTaskStatus[];
  layerReadiness?: WorkspaceIndexLayerReadinessReport | null;
  quickOpenQuery: string;
  recentFiles: string[];
  recentProjects: string[];
  activeOverlay: OverlayKey;
  searchEverywhereMode: SearchEverywhereMode;
  searchEverywhereTruncationNotice: string | null;
  semanticState: SemanticState;
  settingsApplyState: SettingsApplyState;
};

export function getAppShellDerivedState({
  workspace,
  workspaceIndex,
  workspaceIndexState,
  workspaceIndexTaskStatuses,
  layerReadiness = null,
  quickOpenQuery,
  recentFiles,
  recentProjects,
  activeOverlay,
  searchEverywhereMode,
  searchEverywhereTruncationNotice,
  semanticState,
  settingsApplyState,
}: AppShellDerivedStateOptions) {
  const queryReadinessNotice = workspaceIndexState.queryReadiness
    && workspaceIndexState.queryReadiness.state !== "ready"
    && workspaceIndexState.queryReadiness.state !== "missing"
    ? workspaceIndexState.queryReadiness.reason ?? `Index is ${workspaceIndexState.queryReadiness.state}; results may be incomplete.`
    : null;

  const quickOpenResults = activeOverlay === "quickOpen" && workspace
    ? workspaceIndex.queryQuickOpen(quickOpenQuery, 8).flatMap((candidate) => candidate.path ? [{ path: candidate.path }] : [])
    : [];
  const recentFileResults = activeOverlay === "recentFiles"
    ? filterRecentFileResults(recentFiles.map((path) => ({ path, title: getPathBasename(path) })), quickOpenQuery)
    : [];
  const recentProjectResults = activeOverlay === "recentProjects"
    ? filterRecentProjectResults(recentProjects.map((path) => ({ path, name: getPathBasename(path) })), quickOpenQuery)
    : [];

  return {
    quickOpenResults,
    recentFileResults,
    recentProjectResults,
    overlayVisible: activeOverlay !== "none" && activeOverlay !== "completion",
    overlayLabel: activeOverlay === "searchEverywhere"
      ? searchOverlayLabel(searchEverywhereMode)
      : activeOverlay === "none" ? "Quick Open" : getOverlayLabel(activeOverlay),
    semanticCapability: describeSemanticCapabilities(semanticState, settingsApplyState),
    useLazyProjectTree: Boolean(
      workspace
        && (workspace.scanSummary.truncated || workspace.visibleFiles.length >= LAZY_PROJECT_TREE_FILE_THRESHOLD),
    ),
    workspaceScanText: getWorkspaceScanText(workspace),
    workspaceIndexText: getLayerReadinessStatusText(layerReadiness) ?? getIndexStatusText(workspaceIndexState, workspaceIndexTaskStatuses),
    sdkIndexText: getSdkIndexStatusText(workspaceIndexTaskStatuses),
    workspacePartialNotice: searchEverywhereTruncationNotice
      ?? queryReadinessNotice
      ?? workspaceIndexState.partialReason
      ?? getWorkspacePartialNotice(workspace),
  };
}
