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
  onToggleGitBlame: () => void;
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
  onToggleGitBlame,
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
        <button
          type="button"
          className={`status-pill status-pill--button${gitBlameVisible ? " status-pill--active" : ""}`}
          aria-label="Toggle Git Blame"
          onClick={onToggleGitBlame}
        >
          {gitBlameVisible ? "Blame On" : "Blame Off"}
        </button>
        <span className="status-pill status-pill--em">{activeBottomTool === "terminal" && terminalRunning ? "Running" : "Ready"}</span>
        <span className="status-pill">{statusText}</span>
      </div>
    </footer>
  );
}
