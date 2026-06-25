import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { LeftToolRail } from "@/components/layout/LeftToolRail";
import { ProjectToolWindow } from "@/components/layout/ProjectToolWindow";
import type { LeftToolKey } from "@/components/layout/shell-state";
import { ToolWindow } from "@/components/layout/ToolWindow";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";

type ShellSidebarProps = {
  activePath: string | null;
  activeTool: LeftToolKey;
  filesVisible: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  workspace: WorkspaceViewModel | null;
  filesPaneRef: RefObject<HTMLDivElement | null>;
  onOpenFile: (path: string) => void;
  onResizeWidth: (width: number) => void;
  onSelectTool: (tool: LeftToolKey) => void;
};

export function ShellSidebar({
  activePath,
  activeTool,
  filesVisible,
  width,
  minWidth,
  maxWidth,
  workspace,
  filesPaneRef,
  onOpenFile,
  onResizeWidth,
  onSelectTool,
}: ShellSidebarProps) {
  const resizeStartRef = useRef<{ x: number; width: number } | null>(null);
  const activeResizeCleanupRef = useRef<(() => void) | null>(null);

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

  function startResize(clientX: number) {
    cleanupActiveResizeListeners();
    resizeStartRef.current = { x: clientX, width };

    const handleResizeMove = (moveEvent: MouseEvent | PointerEvent) => {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }
      flushSync(() => {
        onResizeWidth(start.width + moveEvent.clientX - start.x);
      });
    };
    const handleResizeEnd = () => {
      cleanupActiveResizeListeners();
    };

    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", handleResizeEnd);
    window.addEventListener("pointercancel", handleResizeEnd);
    window.addEventListener("mousemove", handleResizeMove);
    window.addEventListener("mouseup", handleResizeEnd);
    activeResizeCleanupRef.current = () => {
      window.removeEventListener("pointermove", handleResizeMove);
      window.removeEventListener("pointerup", handleResizeEnd);
      window.removeEventListener("pointercancel", handleResizeEnd);
      window.removeEventListener("mousemove", handleResizeMove);
      window.removeEventListener("mouseup", handleResizeEnd);
    };
  }

  function handleResizePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    startResize(event.clientX);
  }

  function handleResizeMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    startResize(event.clientX);
  }

  function handleResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 40 : 10;
    const resizeByKey: Record<string, number> = {
      ArrowLeft: width - step,
      ArrowRight: width + step,
      PageUp: width + 40,
      PageDown: width - 40,
      Home: minWidth,
      End: maxWidth,
    };
    const nextWidth = resizeByKey[event.key];
    if (nextWidth === undefined) {
      return;
    }

    event.preventDefault();
    onResizeWidth(nextWidth);
  }

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
      {filesVisible ? (
        <div
          aria-label="Resize Left Navigation"
          aria-orientation="vertical"
          aria-valuemax={maxWidth}
          aria-valuemin={minWidth}
          aria-valuenow={width}
          className="sidebar__resize-handle"
          role="separator"
          tabIndex={0}
          onKeyDown={handleResizeKeyDown}
          onMouseDown={handleResizeMouseDown}
          onPointerDown={handleResizePointerDown}
        />
      ) : null}
    </aside>
  );
}
