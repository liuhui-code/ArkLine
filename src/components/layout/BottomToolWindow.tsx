import type { ReactNode, RefObject } from "react";
import type { BottomToolKey } from "@/components/layout/shell-state";

type BottomToolWindowProps = {
  activeTool: BottomToolKey;
  onSelectTool: (tool: BottomToolKey) => void;
  visible?: boolean;
  containerRef?: RefObject<HTMLElement | null>;
  problemsPanel: ReactNode;
  terminalPanel: ReactNode;
  gitPanel: ReactNode;
  gitTracePanel: ReactNode;
  usagesPanel: ReactNode;
};

const tabOrder: BottomToolKey[] = ["problems", "terminal", "git", "gitTrace", "usages"];

const tabLabels: Record<BottomToolKey, string> = {
  problems: "Problems",
  terminal: "Terminal",
  git: "Git",
  gitTrace: "Git Trace",
  usages: "Usages",
};

export function BottomToolWindow({
  activeTool,
  onSelectTool,
  visible = true,
  containerRef,
  problemsPanel,
  terminalPanel,
  gitPanel,
  gitTracePanel,
  usagesPanel,
}: BottomToolWindowProps) {
  return (
    <section aria-label="Bottom Tool Window" className="bottom-tool-window" hidden={!visible} ref={containerRef}>
      <div className="bottom-tool-window__tabs" role="tablist" aria-label="Bottom Tool Window Tabs">
        {tabOrder.map((tool) => (
          <button
            key={tool}
            id={`bottom-tool-tab-${tool}`}
            type="button"
            role="tab"
            aria-selected={activeTool === tool}
            aria-controls={`bottom-tool-panel-${tool}`}
            className={`bottom-tool-window__tab${activeTool === tool ? " bottom-tool-window__tab--active" : ""}`}
            onClick={() => onSelectTool(tool)}
          >
            {tabLabels[tool]}
          </button>
        ))}
      </div>
      <div className="bottom-tool-window__content">
        {activeTool === "problems" ? (
          <div
            id="bottom-tool-panel-problems"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-problems"
          >
            {problemsPanel}
          </div>
        ) : null}
        {activeTool === "terminal" ? (
          <div
            id="bottom-tool-panel-terminal"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-terminal"
          >
            {terminalPanel}
          </div>
        ) : null}
        {activeTool === "git" ? (
          <div
            id="bottom-tool-panel-git"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-git"
          >
            {gitPanel}
          </div>
        ) : null}
        {activeTool === "gitTrace" ? (
          <div
            id="bottom-tool-panel-gitTrace"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-gitTrace"
          >
            {gitTracePanel}
          </div>
        ) : null}
        {activeTool === "usages" ? (
          <div
            id="bottom-tool-panel-usages"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-usages"
          >
            {usagesPanel}
          </div>
        ) : null}
      </div>
    </section>
  );
}
