import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import { IndexExplainPanel } from "@/components/layout/IndexExplainPanel";
import type { BottomToolKey } from "@/components/layout/shell-state";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
import { deriveBackgroundTasks } from "@/components/layout/background-task-model";
import type { SemanticCapabilityState } from "@/features/semantic/semantic-capability-state";
import type { SemanticState } from "@/features/semantic/semantic-store";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexTaskStatus,
} from "@/features/workspace/workspace-api";
import type { WorkspaceIndexExplainResult } from "@/features/workspace/workspace-index-api-types";
import type { RecentQueryExplain } from "@/features/workspace/workspace-query-explain-model";
import type { UiLatencySample } from "@/features/performance/ui-latency-monitor";
import type { IpcLatencySample } from "@/features/performance/ipc-latency-store";
import type { RenderPressureSample } from "@/features/performance/render-pressure-store";
import type { StatusMessageStore } from "@/features/status/status-message-store";
import type { BuildState } from "@/features/build/build-model";

export type AppShellIndexAndStatusSurfacesProps = {
  activeBottomTool: BottomToolKey;
  activePath: string | null;
  definitionDebugText: string | null;
  latestExplainResult: WorkspaceIndexExplainResult | null;
  latestExplainQuery: string;
  onOpenIndexExplainPanel: () => void;
  indexExplainPanelVisible: boolean;
  onCloseIndexExplainPanel: () => void;
  onRebuildIndexFromExplainPanel: () => void;
  onOpenSettingsFromExplainPanel: () => void;
  onRetryLatestExplainQuery: () => void;
  indexDiagnosticsVisible: boolean;
  indexDiagnosticsSectionTarget: string | null;
  indexDiagnosticsLoading: boolean;
  currentFileDirty: boolean;
  indexDiagnostics: WorkspaceIndexDiagnostics | null;
  currentFileReadiness: WorkspaceIndexFileReadiness | null;
  layerReadiness: WorkspaceIndexLayerReadinessReport | null;
  recentQueryExplains: RecentQueryExplain[];
  uiLatencySamples: UiLatencySample[];
  renderPressureSamples: RenderPressureSample[];
  ipcLatencySamples: IpcLatencySample[];
  workspaceIndexTaskStatuses: WorkspaceIndexTaskStatus[];
  onCloseIndexDiagnostics: () => void;
  onRefreshIndexDiagnostics: () => void;
  onResumeIndexingFromDiagnostics: () => void;
  onRebuildProjectIndexFromDiagnostics: () => void;
  onRebuildSdkIndexFromDiagnostics: () => void;
  onIndexCurrentFileFromDiagnostics: () => void;
  onConfigureSdkFromDiagnostics: () => void;
  semanticState: SemanticState;
  semanticCapability: SemanticCapabilityState;
  statusMessageStore: StatusMessageStore;
  workspaceName: string | null;
  gitBranchName: string;
  gitChangeCount: number;
  gitAhead: number;
  gitBehind: number;
  workspaceScanText: string | null;
  workspaceIndexText: string;
  sdkIndexText: string | null;
  buildMessage: string;
  buildState: Pick<BuildState, "status" | "message">;
  onStopBuild: () => void;
  currentLineBlame: string | null;
  gitBlameVisible: boolean;
  gitBlameMenuOpen: boolean;
  onToggleGitBlameMenu: () => void;
  onToggleGitBlame: () => void;
  onRefreshGitBlame: () => void;
  onShowCurrentLineBlame: () => void;
  onCloseGitBlame: () => void;
  onOpenIndexDiagnostics: (sectionTarget?: string) => void;
  onOpenGitBranchPicker: () => void;
};

export function AppShellIndexAndStatusSurfaces({
  activeBottomTool,
  activePath,
  definitionDebugText,
  latestExplainResult,
  latestExplainQuery,
  onOpenIndexExplainPanel,
  indexExplainPanelVisible,
  onCloseIndexExplainPanel,
  onRebuildIndexFromExplainPanel,
  onOpenSettingsFromExplainPanel,
  onRetryLatestExplainQuery,
  indexDiagnosticsVisible,
  indexDiagnosticsSectionTarget,
  indexDiagnosticsLoading,
  currentFileDirty,
  indexDiagnostics,
  currentFileReadiness,
  layerReadiness,
  recentQueryExplains,
  uiLatencySamples,
  renderPressureSamples,
  ipcLatencySamples,
  workspaceIndexTaskStatuses,
  onCloseIndexDiagnostics,
  onRefreshIndexDiagnostics,
  onResumeIndexingFromDiagnostics,
  onRebuildProjectIndexFromDiagnostics,
  onRebuildSdkIndexFromDiagnostics,
  onIndexCurrentFileFromDiagnostics,
  onConfigureSdkFromDiagnostics,
  semanticState,
  semanticCapability,
  statusMessageStore,
  workspaceName,
  gitBranchName,
  gitChangeCount,
  gitAhead,
  gitBehind,
  workspaceScanText,
  workspaceIndexText,
  sdkIndexText,
  buildMessage,
  buildState,
  onStopBuild,
  currentLineBlame,
  gitBlameVisible,
  gitBlameMenuOpen,
  onToggleGitBlameMenu,
  onToggleGitBlame,
  onRefreshGitBlame,
  onShowCurrentLineBlame,
  onCloseGitBlame,
  onOpenIndexDiagnostics,
  onOpenGitBranchPicker,
}: AppShellIndexAndStatusSurfacesProps) {
  const backgroundTasks = deriveBackgroundTasks(workspaceIndexTaskStatuses, buildState);

  return (
    <>
      <div
        aria-label="Definition Debug Banner"
        aria-live="polite"
        className={`definition-debug-banner${definitionDebugText ? " definition-debug-banner--visible" : ""}`}
        hidden={!definitionDebugText}
      >
        <button
          type="button"
          className="definition-debug-banner__button"
          disabled={!latestExplainResult}
          onClick={onOpenIndexExplainPanel}
        >
          {definitionDebugText}
        </button>
      </div>
      {indexExplainPanelVisible && latestExplainResult ? (
        <IndexExplainPanel
          result={latestExplainResult}
          query={latestExplainQuery}
          onClose={onCloseIndexExplainPanel}
          onRebuildIndex={onRebuildIndexFromExplainPanel}
          onOpenSettings={onOpenSettingsFromExplainPanel}
          onRetryQuery={onRetryLatestExplainQuery}
        />
      ) : null}
      <IndexDiagnosticsCenter
        open={indexDiagnosticsVisible}
        loading={indexDiagnosticsLoading}
        sectionTarget={indexDiagnosticsSectionTarget}
        activePath={activePath}
        currentFileDirty={currentFileDirty}
        diagnostics={indexDiagnostics}
        fileReadiness={currentFileReadiness}
        layerReadiness={layerReadiness}
        recentQueryExplains={recentQueryExplains}
        uiLatencySamples={uiLatencySamples}
        renderPressureSamples={renderPressureSamples}
        ipcLatencySamples={ipcLatencySamples}
        taskStatuses={workspaceIndexTaskStatuses}
        semanticState={semanticState}
        onClose={onCloseIndexDiagnostics}
        onRefresh={onRefreshIndexDiagnostics}
        onResumeIndexing={onResumeIndexingFromDiagnostics}
        onRebuildProjectIndex={onRebuildProjectIndexFromDiagnostics}
        onRebuildSdkIndex={onRebuildSdkIndexFromDiagnostics}
        onIndexCurrentFile={onIndexCurrentFileFromDiagnostics}
        onConfigureSdk={onConfigureSdkFromDiagnostics}
      />
      <ShellStatusBar
        activeBottomTool={activeBottomTool}
        activePath={activePath}
        semanticState={semanticState}
        semanticCapability={semanticCapability}
        statusMessageStore={statusMessageStore}
        workspaceName={workspaceName}
        gitBranchName={gitBranchName}
        gitChangeCount={gitChangeCount}
        gitAhead={gitAhead}
        gitBehind={gitBehind}
        workspaceScanText={workspaceScanText}
        workspaceIndexText={workspaceIndexText}
        sdkIndexText={sdkIndexText}
        terminalRunning={false}
        buildMessage={buildMessage}
        currentLineBlame={currentLineBlame}
        gitBlameVisible={gitBlameVisible}
        gitBlameMenuOpen={gitBlameMenuOpen}
        onToggleGitBlameMenu={onToggleGitBlameMenu}
        onToggleGitBlame={onToggleGitBlame}
        onRefreshGitBlame={onRefreshGitBlame}
        onShowCurrentLineBlame={onShowCurrentLineBlame}
        onCloseGitBlame={onCloseGitBlame}
        onOpenIndexDiagnostics={onOpenIndexDiagnostics}
        onOpenGitBranchPicker={onOpenGitBranchPicker}
        backgroundTasks={backgroundTasks}
        onCancelBackgroundTask={(taskId) => {
          if (taskId === "build:current") onStopBuild();
        }}
      />
    </>
  );
}
