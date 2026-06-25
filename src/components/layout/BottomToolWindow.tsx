import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import type { BottomToolKey } from "@/components/layout/shell-state";

type BottomToolWindowProps = {
  activeTool: BottomToolKey;
  contentVisible?: boolean;
  height: number;
  maxHeight: number;
  onResizeHeight: (height: number) => void;
  onToggleMaxHeight: () => void;
  onToggleTool: (tool: BottomToolKey) => void;
  onRestore: () => void;
  onClose: () => void;
  containerRef?: RefObject<HTMLElement | null>;
  problemsPanel: ReactNode;
  terminalPanel: ReactNode;
  buildPanel: ReactNode;
  gitPanel: ReactNode;
};

const minHeight = 160;
const tabOrder: BottomToolKey[] = ["problems", "terminal", "build", "git"];

const tabLabels: Record<BottomToolKey, string> = {
  problems: "Problems",
  terminal: "Terminal",
  build: "Build",
  git: "Git",
};

export function BottomToolWindow({
  activeTool,
  contentVisible = true,
  height,
  maxHeight,
  onResizeHeight,
  onToggleMaxHeight,
  onToggleTool,
  onRestore,
  onClose,
  containerRef,
  problemsPanel,
  terminalPanel,
  buildPanel,
  gitPanel,
}: BottomToolWindowProps) {
  const resizeStartRef = useRef<{ y: number; height: number } | null>(null);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);
  const isMaximized = Math.abs(height - maxHeight) <= 2;

  useEffect(() => {
    return () => {
      resizeStartRef.current = null;
      activeResizeCleanupRef.current?.();
      activeResizeCleanupRef.current = null;
    };
  }, []);

  function cleanupActiveResizeListeners() {
    resizeStartRef.current = null;
    activeResizeCleanupRef.current?.();
    activeResizeCleanupRef.current = null;
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    cleanupActiveResizeListeners();
    resizeStartRef.current = { y: event.clientY, height };

    const handleResizePointerMove = (moveEvent: PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      flushSync(() => {
        onResizeHeight(start.height + start.y - moveEvent.clientY);
      });
    };
    const handleResizePointerEnd = () => {
      cleanupActiveResizeListeners();
    };

    window.addEventListener("pointermove", handleResizePointerMove);
    window.addEventListener("pointerup", handleResizePointerEnd);
    window.addEventListener("pointercancel", handleResizePointerEnd);
    activeResizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", handleResizePointerMove);
      window.removeEventListener("pointerup", handleResizePointerEnd);
      window.removeEventListener("pointercancel", handleResizePointerEnd);
    };
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const resizeByKey: Record<string, number> = {
      ArrowUp: height + 10,
      ArrowDown: height - 10,
      PageUp: height + 40,
      PageDown: height - 40,
      Home: minHeight,
      End: maxHeight,
    };
    const nextHeight = resizeByKey[event.key];
    if (nextHeight === undefined) {
      return;
    }

    event.preventDefault();
    onResizeHeight(nextHeight);
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
          aria-valuemax={maxHeight}
          aria-valuemin={minHeight}
          aria-valuenow={height}
          className="bottom-tool-window__resize-handle"
          role="separator"
          tabIndex={0}
          onDoubleClick={onToggleMaxHeight}
          onKeyDown={handleResizeKeyDown}
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
        <div className="bottom-tool-window__actions">
          {contentVisible ? (
            <button
              type="button"
              className="bottom-tool-window__action"
              aria-label={isMaximized ? "Restore Bottom Tool Window" : "Maximize Bottom Tool Window"}
              onClick={onToggleMaxHeight}
            >
              {isMaximized ? "▱" : "▢"}
            </button>
          ) : null}
          {contentVisible ? (
            <button
              type="button"
              className="bottom-tool-window__close"
              aria-label="Hide Bottom Tool Window"
              onClick={onClose}
            >
              ×
            </button>
          ) : (
            <button
              type="button"
              className="bottom-tool-window__action"
              aria-label="Show Bottom Tool Window"
              onClick={onRestore}
            >
              ▴
            </button>
          )}
        </div>
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
        {activeTool === "build" ? (
          <div
            id="bottom-tool-panel-build"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-build"
          >
            {buildPanel}
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
      </div>
    </section>
  );
}
