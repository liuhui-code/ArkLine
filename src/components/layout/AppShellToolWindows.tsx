import type { RefObject } from "react";
import { BottomToolWindow } from "@/components/layout/BottomToolWindow";
import { BuildToolWindow } from "@/components/layout/BuildToolWindow";
import { DeviceLogToolWindow } from "@/components/layout/DeviceLogToolWindow";
import { GitToolWindow } from "@/components/layout/GitToolWindow";
import { GitTracePanel } from "@/components/layout/GitTracePanel";
import {
  AppShellIndexAndStatusSurfaces,
  type AppShellIndexAndStatusSurfacesProps,
} from "@/components/layout/AppShellIndexAndStatusSurfaces";
import { ProblemsPanel } from "@/components/layout/ProblemsPanel";
import type { BottomToolKey } from "@/components/layout/shell-state";
import { TerminalToolWindowHost } from "@/components/layout/TerminalToolWindowHost";
import type { BuildState, BuildTarget } from "@/features/build/build-model";
import type { DiffFile } from "@/features/diff/unified-diff";
import type { GitTraceState } from "@/features/git/git-trace-model";
import type { ProblemItem } from "@/features/problems/problems-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type AppShellToolWindowsProps = {
  bottomToolWindowRef: RefObject<HTMLElement | null>;
  activeBottomTool: BottomToolKey;
  bottomContentVisible: boolean;
  bottomToolHeight: number;
  bottomLayoutToken: number;
  maxBottomToolHeight: () => number;
  resizeBottomToolWindow: (height: number) => void;
  toggleBottomToolMaxHeight: () => void;
  showBottomTool: (tool: BottomToolKey) => void;
  toggleBottomTool: (tool: BottomToolKey) => void;
  hideBottomToolWindow: () => void;
  problems: ProblemItem[];
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
  buildState: BuildState;
  buildModules: string[];
  onChangeBuildTarget: (lastTarget: BuildTarget) => void;
  onChangeBuildModuleName: (moduleName: string) => void;
  onChangeBuildProduct: (product: string) => void;
  onChangeBuildMode: (buildMode: BuildState["buildMode"]) => void;
  onChangeBuildFastMode: (fastMode: boolean) => void;
  onSelectBuildConfiguration: (configurationId: string) => void;
  onSaveBuildConfiguration: () => void;
  onCopyBuildConfiguration: () => void;
  onDeleteBuildConfiguration: () => void;
  onRunBuild: () => void;
  onRunCleanBuild: () => void;
  onStopBuild: () => void;
  diffFiles: DiffFile[];
  gitToolView: "changes" | "trace";
  gitTraceState: GitTraceState;
  onChangeGitToolView: (view: "changes" | "trace") => void;
  onOpenGitFile: (path: string) => void;
  onFocusEditorFromGitTrace: () => void;
  onOpenGitTraceCommitDiff: (patch: string) => void;
  onStatusChange: (message: string) => void;
  indexAndStatus: AppShellIndexAndStatusSurfacesProps;
};

export function AppShellToolWindows({
  bottomToolWindowRef,
  activeBottomTool,
  bottomContentVisible,
  bottomToolHeight,
  bottomLayoutToken,
  maxBottomToolHeight,
  resizeBottomToolWindow,
  toggleBottomToolMaxHeight,
  showBottomTool,
  toggleBottomTool,
  hideBottomToolWindow,
  problems,
  workspaceApi,
  workspaceRootPath,
  buildState,
  buildModules,
  onChangeBuildTarget,
  onChangeBuildModuleName,
  onChangeBuildProduct,
  onChangeBuildMode,
  onChangeBuildFastMode,
  onSelectBuildConfiguration,
  onSaveBuildConfiguration,
  onCopyBuildConfiguration,
  onDeleteBuildConfiguration,
  onRunBuild,
  onRunCleanBuild,
  onStopBuild,
  diffFiles,
  gitToolView,
  gitTraceState,
  onChangeGitToolView,
  onOpenGitFile,
  onFocusEditorFromGitTrace,
  onOpenGitTraceCommitDiff,
  onStatusChange,
  indexAndStatus,
}: AppShellToolWindowsProps) {
  return (
    <>
      <BottomToolWindow
        containerRef={bottomToolWindowRef}
        activeTool={activeBottomTool}
        contentVisible={bottomContentVisible}
        height={bottomToolHeight}
        maxHeight={maxBottomToolHeight()}
        onResizeHeight={resizeBottomToolWindow}
        onToggleMaxHeight={toggleBottomToolMaxHeight}
        onShowTool={showBottomTool}
        onToggleTool={toggleBottomTool}
        onRestore={() => showBottomTool(activeBottomTool)}
        onClose={hideBottomToolWindow}
        problemsPanel={<ProblemsPanel problems={problems} />}
        terminalPanel={<TerminalToolWindowHost active={bottomContentVisible && activeBottomTool === "terminal"} layoutToken={bottomLayoutToken} onStatusChange={onStatusChange} workspaceApi={workspaceApi} workspaceRootPath={workspaceRootPath} />}
        buildPanel={<BuildToolWindow state={buildState} workspaceRootPath={workspaceRootPath} modules={buildModules} onChangeTarget={onChangeBuildTarget} onChangeModuleName={onChangeBuildModuleName} onChangeProduct={onChangeBuildProduct} onChangeBuildMode={onChangeBuildMode} onChangeFastMode={onChangeBuildFastMode} onSelectConfiguration={onSelectBuildConfiguration} onSaveConfiguration={onSaveBuildConfiguration} onCopyConfiguration={onCopyBuildConfiguration} onDeleteConfiguration={onDeleteBuildConfiguration} onRunBuild={onRunBuild} onRunCleanBuild={onRunCleanBuild} onStopBuild={onStopBuild} />}
        gitPanel={<GitToolWindow files={diffFiles} activeView={gitToolView} tracePanel={<GitTracePanel state={gitTraceState} onOpenInEditor={onFocusEditorFromGitTrace} onOpenCommitDiff={onOpenGitTraceCommitDiff} />} onChangeView={onChangeGitToolView} onOpenFile={onOpenGitFile} />}
        deviceLogPanel={<DeviceLogToolWindow active={bottomContentVisible && activeBottomTool === "deviceLog"} workspaceApi={workspaceApi} onStatusChange={onStatusChange} />}
      />
      <AppShellIndexAndStatusSurfaces {...indexAndStatus} />
    </>
  );
}
