import type { RefObject } from "react";
import { LeftToolRail } from "@/components/layout/LeftToolRail";
import { ProjectToolWindow } from "@/components/layout/ProjectToolWindow";
import type { LeftToolKey } from "@/components/layout/shell-state";
import { ToolWindow } from "@/components/layout/ToolWindow";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";

type ShellSidebarProps = {
  activePath: string | null;
  activeTool: LeftToolKey;
  filesVisible: boolean;
  workspace: WorkspaceViewModel | null;
  filesPaneRef: RefObject<HTMLDivElement | null>;
  onOpenFile: (path: string) => void;
  onSelectTool: (tool: LeftToolKey) => void;
};

export function ShellSidebar({
  activePath,
  activeTool,
  filesVisible,
  workspace,
  filesPaneRef,
  onOpenFile,
  onSelectTool,
}: ShellSidebarProps) {
  return (
    <aside className="sidebar">
      <LeftToolRail activeTool={activeTool} onSelectTool={onSelectTool} />
      <div className="sidebar__panes">
        <div ref={filesPaneRef} className="sidebar__pane">
          <ToolWindow ariaLabel="Files" title="Project" caption="Files" visible={filesVisible} className="tool-window">
            {workspace ? (
              <ProjectToolWindow tree={workspace.fileTree} activePath={activePath} onOpen={onOpenFile} />
            ) : (
              <p>Workspace files will appear here.</p>
            )}
          </ToolWindow>
        </div>
      </div>
    </aside>
  );
}
