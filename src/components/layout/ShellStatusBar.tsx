import { getPathBasename } from "@/features/workspace/workspace-store";

type ShellStatusBarProps = {
  activeBottomTool: "problems" | "terminal" | "git";
  activePath: string | null;
  statusText: string;
  workspaceName: string | null;
  terminalRunning: boolean;
};

export function ShellStatusBar({
  activeBottomTool,
  activePath,
  statusText,
  workspaceName,
  terminalRunning,
}: ShellStatusBarProps) {
  return (
    <footer aria-label="Status Bar" className="status-bar">
      <div aria-label="Status Bar Left" className="status-bar__group status-bar__group--left">
        <span className="status-pill status-pill--em">{`Workspace: ${workspaceName ?? "none"}`}</span>
        <span className="status-pill">{activePath ? getPathBasename(activePath) : "No file selected"}</span>
      </div>
      <div aria-label="Status Bar Right" className="status-bar__group status-bar__group--right">
        <span className="status-pill status-pill--em">{activeBottomTool === "terminal" && terminalRunning ? "Running" : "Ready"}</span>
        <span className="status-pill">{statusText}</span>
      </div>
    </footer>
  );
}
