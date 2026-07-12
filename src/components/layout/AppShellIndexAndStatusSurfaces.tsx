import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import { IndexExplainPanel } from "@/components/layout/IndexExplainPanel";
import type { BottomToolKey } from "@/components/layout/shell-state";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
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
  onConfigureSdkFromDiagnostics: () => void;
  semanticState: SemanticState;
  semanticCapability: SemanticCapabilityState;
  statusText: string;
  workspaceName: string | null;
  workspaceScanText: string | null;
  workspaceIndexText: string;
  sdkIndexText: string | null;
  buildMessage: string;
  currentLineBlame: string | null;
  gitBlameVisible: boolean;
  gitBlameMenuOpen: boolean;
  onToggleGitBlameMenu: () => void;
  onToggleGitBlame: () => void;
  onRefreshGitBlame: () => void;
  onShowCurrentLineBlame: () => void;
  onCloseGitBlame: () => void;
  onOpenIndexDiagnostics: () => void;
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
  onConfigureSdkFromDiagnostics,
  semanticState,
  semanticCapability,
  statusText,
  workspaceName,
  workspaceScanText,
  workspaceIndexText,
  sdkIndexText,
  buildMessage,
  currentLineBlame,
  gitBlameVisible,
  gitBlameMenuOpen,
  onToggleGitBlameMenu,
  onToggleGitBlame,
  onRefreshGitBlame,
  onShowCurrentLineBlame,
  onCloseGitBlame,
  onOpenIndexDiagnostics,
}: AppShellIndexAndStatusSurfacesProps) {
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
        onClose={onCloseIndexDiagnostics}
        onRefresh={onRefreshIndexDiagnostics}
        onResumeIndexing={onResumeIndexingFromDiagnostics}
        onRebuildProjectIndex={onRebuildProjectIndexFromDiagnostics}
        onRebuildSdkIndex={onRebuildSdkIndexFromDiagnostics}
        onConfigureSdk={onConfigureSdkFromDiagnostics}
      />
      <ShellStatusBar
        activeBottomTool={activeBottomTool}
        activePath={activePath}
        semanticState={semanticState}
        semanticCapability={semanticCapability}
        statusText={statusText}
        workspaceName={workspaceName}
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
      />
    </>
  );
}
