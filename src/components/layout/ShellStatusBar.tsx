import type { BottomToolKey } from "@/components/layout/shell-state";
import { SemanticModeBadge } from "@/components/layout/SemanticModeBadge";
import type { SemanticState } from "@/features/semantic/semantic-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

type ShellStatusBarProps = {
  activeBottomTool: BottomToolKey;
  activePath: string | null;
  semanticState: SemanticState;
  statusText: string;
  workspaceName: string | null;
  terminalRunning: boolean;
  currentLineBlame?: string | null;
  gitBlameVisible: boolean;
  gitBlameMenuOpen: boolean;
  onToggleGitBlameMenu: () => void;
  onToggleGitBlame: () => void;
  onRefreshGitBlame: () => void;
  onShowCurrentLineBlame: () => void;
  onCloseGitBlame: () => void;
};

export function ShellStatusBar({
  activeBottomTool,
  activePath,
  semanticState,
  statusText,
  workspaceName,
  terminalRunning,
  currentLineBlame = null,
  gitBlameVisible,
  gitBlameMenuOpen,
  onToggleGitBlameMenu,
  onToggleGitBlame,
  onRefreshGitBlame,
  onShowCurrentLineBlame,
  onCloseGitBlame,
}: ShellStatusBarProps) {
  return (
    <footer aria-label="Status Bar" className="status-bar">
      <div aria-label="Status Bar Left" className="status-bar__group status-bar__group--left">
        <span className="status-pill status-pill--em">{`Workspace: ${workspaceName ?? "none"}`}</span>
        <span className="status-pill">{activePath ? getPathBasename(activePath) : "No file selected"}</span>
        <SemanticModeBadge semanticState={semanticState} />
      </div>
      <div aria-label="Status Bar Right" className="status-bar__group status-bar__group--right">
        {currentLineBlame ? <span className="status-pill status-pill--blame">{currentLineBlame}</span> : null}
        <div className="status-blame-menu">
          <button
            type="button"
            className={`status-pill status-pill--button${gitBlameVisible ? " status-pill--active" : ""}`}
            aria-label="Blame actions"
            aria-expanded={gitBlameMenuOpen}
            onClick={onToggleGitBlameMenu}
          >
            {gitBlameVisible ? "Blame On" : "Blame Off"}
          </button>
          {gitBlameMenuOpen ? (
            <div role="menu" aria-label="Git Blame Actions" className="status-blame-menu__popup">
              <button type="button" role="menuitem" onClick={onToggleGitBlame}>Toggle Git Blame</button>
              <button type="button" role="menuitem" onClick={onRefreshGitBlame}>Refresh Blame</button>
              <button type="button" role="menuitem" onClick={onShowCurrentLineBlame}>Show Current Line Commit</button>
              <button type="button" role="menuitem" onClick={onCloseGitBlame}>Close Blame</button>
            </div>
          ) : null}
        </div>
        <span className="status-pill status-pill--em">{activeBottomTool === "terminal" && terminalRunning ? "Running" : "Ready"}</span>
        <span className="status-pill">{statusText}</span>
      </div>
    </footer>
  );
}
