import type { RefObject } from "react";
import {
  AppShellEditorWorkbench,
  type AppShellEditorWorkbenchProps,
} from "@/components/layout/AppShellEditorWorkbench";
import {
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from "@/components/layout/app-shell-constants";
import type { BottomToolKey, LeftToolKey, OverlayKey } from "@/components/layout/shell-state";
import { ShellSidebar } from "@/components/layout/ShellSidebar";
import { TopBar } from "@/components/layout/TopBar";
import type { ProjectMutationRequest } from "@/components/layout/ProjectToolWindow";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";
import type { WorkspaceDirectoryEntry } from "@/features/workspace/workspace-api";

type AppShellMainLayoutProps = {
  topBar: {
    activeBottomTool: BottomToolKey;
    bottomToolVisible: boolean;
    activeOverlay: OverlayKey;
    workspaceName: string | null;
    settingsOpen: boolean;
    onOpenProject: () => void;
    onOpenRecentProjects: () => void;
    onNewFile: () => void;
    onNewDirectory: () => void;
    onOpenSearchEverywhere: () => void;
    onOpenFindInFiles: () => void;
    onOpenReplaceInFiles: () => void;
    onOpenCommandPalette: () => void;
    onRunLint: () => void;
    onRunBuild: () => void;
    onFormat: () => void;
    onLoadDiff: () => void;
    onOpenTerminal: () => void;
    onOpenSettings: () => void;
    onToggleEditorOnly: () => void;
  };
  sidebar: {
    activePath: string | null;
    selectedProjectPath: string | null;
    activeTool: LeftToolKey;
    filesVisible: boolean;
    width: number;
    workspace: WorkspaceViewModel | null;
    useLazyProjectTree: boolean;
    projectTreeChildren: Record<string, WorkspaceDirectoryEntry[]>;
    projectTreeLoadingPaths: Set<string>;
    filesPaneRef: RefObject<HTMLDivElement | null>;
    onOpenFile: (path: string) => void;
    onSelectProjectPath: (path: string) => void;
    onLoadProjectDirectory: (path: string) => void;
    onRequestProjectMutation: (request: ProjectMutationRequest) => void;
    onResizeWidth: (width: number) => void;
    onSelectTool: (tool: LeftToolKey) => void;
  };
  editor: AppShellEditorWorkbenchProps;
};

export function AppShellMainLayout({ topBar, sidebar, editor }: AppShellMainLayoutProps) {
  return (
    <>
      <TopBar {...topBar} />
      <div
        className="shell-grid"
        style={{ gridTemplateColumns: `${sidebar.filesVisible ? sidebar.width : LEFT_SIDEBAR_COLLAPSED_WIDTH}px 1fr` }}
      >
        <ShellSidebar
          activePath={sidebar.activePath}
          selectedProjectPath={sidebar.selectedProjectPath}
          activeTool={sidebar.activeTool}
          filesVisible={sidebar.filesVisible}
          width={sidebar.width}
          minWidth={LEFT_SIDEBAR_MIN_WIDTH}
          maxWidth={LEFT_SIDEBAR_MAX_WIDTH}
          workspace={sidebar.workspace}
          useLazyProjectTree={sidebar.useLazyProjectTree}
          projectTreeChildren={sidebar.projectTreeChildren}
          projectTreeLoadingPaths={sidebar.projectTreeLoadingPaths}
          filesPaneRef={sidebar.filesPaneRef}
          onOpenFile={sidebar.onOpenFile}
          onSelectProjectPath={sidebar.onSelectProjectPath}
          onLoadProjectDirectory={sidebar.onLoadProjectDirectory}
          onRequestProjectMutation={sidebar.onRequestProjectMutation}
          onResizeWidth={sidebar.onResizeWidth}
          onSelectTool={sidebar.onSelectTool}
        />
        <AppShellEditorWorkbench {...editor} />
      </div>
    </>
  );
}
