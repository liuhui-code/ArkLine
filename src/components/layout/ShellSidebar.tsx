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
  searchQuery: string;
  searchResults: { path: string }[];
  searchVisible: boolean;
  workspace: WorkspaceViewModel | null;
  filesPaneRef: RefObject<HTMLDivElement | null>;
  searchPaneRef: RefObject<HTMLDivElement | null>;
  onOpenFile: (path: string) => void;
  onSearchQueryChange: (value: string) => void;
  onSelectTool: (tool: LeftToolKey) => void;
};

export function ShellSidebar({
  activePath,
  activeTool,
  filesVisible,
  searchQuery,
  searchResults,
  searchVisible,
  workspace,
  filesPaneRef,
  searchPaneRef,
  onOpenFile,
  onSearchQueryChange,
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
        <div ref={searchPaneRef} className="sidebar__pane">
          <ToolWindow ariaLabel="Search" title="Search" caption="Workspace" visible={searchVisible} className="tool-window">
            <div className="search-panel">
              <input
                aria-label="Search Query"
                className="panel-input"
                value={searchQuery}
                placeholder="Search paths"
                onChange={(event) => onSearchQueryChange(event.target.value)}
              />
              {searchResults.length > 0 ? (
                <div className="search-results" role="list" aria-label="Search Results">
                  {searchResults.map((result) => (
                    <button
                      key={result.path}
                      type="button"
                      className="search-result"
                      onClick={() => onOpenFile(result.path)}
                    >
                      {result.path}
                    </button>
                  ))}
                </div>
              ) : (
                <p>Type a path fragment to filter the workspace.</p>
              )}
            </div>
          </ToolWindow>
        </div>
      </div>
    </aside>
  );
}
