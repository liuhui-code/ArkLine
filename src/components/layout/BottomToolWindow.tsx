import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { BottomToolKey } from "@/components/layout/shell-state";

type BottomToolWindowProps = {
  activeTool: BottomToolKey;
  contentVisible?: boolean;
  height: number;
  onResizeHeight: (height: number) => void;
  onToggleMaxHeight: () => void;
  onToggleTool: (tool: BottomToolKey) => void;
  onClose: () => void;
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
  contentVisible = true,
  height,
  onResizeHeight,
  onToggleMaxHeight,
  onToggleTool,
  onClose,
  containerRef,
  problemsPanel,
  terminalPanel,
  gitPanel,
  gitTracePanel,
  usagesPanel,
}: BottomToolWindowProps) {
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);

  useEffect(() => {
    return () => {
      resizeStartRef.current = null;
      window.removeEventListener("pointermove", handleResizePointerMove);
      window.removeEventListener("pointerup", handleResizePointerUp);
    };
  }, []);

  function handleResizePointerMove(event: PointerEvent) {
    const start = resizeStartRef.current;
    if (!start) {
      return;
    }
    flushSync(() => {
      onResizeHeight(start.height + start.y - event.clientY);
    });
  }

  function handleResizePointerUp() {
    resizeStartRef.current = null;
    window.removeEventListener("pointermove", handleResizePointerMove);
    window.removeEventListener("pointerup", handleResizePointerUp);
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    resizeStartRef.current = { y: event.clientY, height };
    window.addEventListener("pointermove", handleResizePointerMove);
    window.addEventListener("pointerup", handleResizePointerUp);
  }

  return (
    <section
      aria-label="Bottom Tool Window"
      className="bottom-tool-window"
      data-collapsed={contentVisible ? "false" : "true"}
      ref={containerRef}
      style={{ height: contentVisible ? `${height}px` : "29px" }}
    >
      {contentVisible ? (
        <div
          aria-label="Resize Bottom Tool Window"
          aria-orientation="horizontal"
          className="bottom-tool-window__resize-handle"
          role="separator"
          onDoubleClick={onToggleMaxHeight}
          onPointerDown={handleResizePointerDown}
        />
      ) : null}
      <div className="bottom-tool-window__chrome">
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
              onClick={() => onToggleTool(tool)}
            >
              {tabLabels[tool]}
            </button>
          ))}
        </div>
          <button
            type="button"
            className="bottom-tool-window__close"
            aria-label="Hide Bottom Tool Window"
            onClick={onClose}
          >
            ×
          </button>
      </div>
      <div className="bottom-tool-window__content" hidden={!contentVisible}>
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
