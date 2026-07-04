import { useRef, useState } from "react";
import {
  LEFT_SIDEBAR_DEFAULT_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from "@/components/layout/app-shell-constants";
import { clampNumber } from "@/components/layout/app-shell-model";
import { getOverlayLabel } from "@/components/layout/search-overlay-model";
import type { BottomToolKey, LeftToolKey, OverlayKey } from "@/components/layout/shell-state";

export type UseShellLayoutStateOptions = {
  onBeforeNonCompletionOverlay?: () => void;
  onResetOverlaySearch?: () => void;
  onStatusChange: (message: string) => void;
  onFocusEditorSoon: () => void;
};

export function useShellLayoutState({
  onBeforeNonCompletionOverlay,
  onResetOverlaySearch,
  onStatusChange,
  onFocusEditorSoon,
}: UseShellLayoutStateOptions) {
  const [filesVisible, setFilesVisible] = useState(true);
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(LEFT_SIDEBAR_DEFAULT_WIDTH);
  const [bottomContentVisible, setBottomContentVisible] = useState(true);
  const [bottomToolHeight, setBottomToolHeight] = useState(280);
  const [bottomLayoutToken, setBottomLayoutToken] = useState(0);
  const [activeLeftTool, setActiveLeftTool] = useState<LeftToolKey>("project");
  const [activeBottomTool, setActiveBottomTool] = useState<BottomToolKey>("problems");
  const [activeOverlay, setActiveOverlay] = useState<OverlayKey>("none");
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const filesPaneRef = useRef<HTMLDivElement | null>(null);
  const bottomToolWindowRef = useRef<HTMLElement | null>(null);

  function maxBottomToolHeight() {
    return Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.7);
  }

  function clampBottomToolHeight(height: number) {
    return Math.max(160, Math.min(maxBottomToolHeight(), Math.round(height)));
  }

  function resizeBottomToolWindow(height: number) {
    setBottomToolHeight(clampBottomToolHeight(height));
    setBottomLayoutToken((token) => token + 1);
  }

  function resizeLeftSidebar(width: number) {
    setLeftSidebarWidth(clampNumber(Math.round(width), LEFT_SIDEBAR_MIN_WIDTH, LEFT_SIDEBAR_MAX_WIDTH));
  }

  function toggleBottomToolMaxHeight() {
    const maxHeight = maxBottomToolHeight();
    const nextHeight = Math.abs(bottomToolHeight - maxHeight) <= 2 ? 280 : maxHeight;
    resizeBottomToolWindow(nextHeight);
  }

  function showBottomTool(tool: BottomToolKey) {
    setBottomContentVisible(true);
    setBottomLayoutToken((token) => token + 1);
    setActiveBottomTool(tool);
    onStatusChange(
      tool === "terminal" ? "Terminal"
      : tool === "build" ? "Build"
      : tool === "git" ? "Git"
      : "Problems",
    );
  }

  function showLeftTool(tool: LeftToolKey) {
    if (tool === "project") {
      const nextVisible = activeLeftTool !== "project" || !filesVisible;
      setActiveLeftTool("project");
      setFilesVisible(nextVisible);
      onStatusChange(nextVisible ? "Project" : "Editor");
      return;
    }
    setActiveLeftTool(tool);
    showBottomTool(tool === "git" ? "git" : "problems");
  }

  function hideBottomToolWindow() {
    setBottomContentVisible(false);
    onStatusChange("Editor");
    onFocusEditorSoon();
  }

  function toggleBottomTool(tool: BottomToolKey) {
    if (bottomContentVisible && activeBottomTool === tool) {
      hideBottomToolWindow();
      return;
    }
    showBottomTool(tool);
  }

  function setOverlay(overlay: Exclude<OverlayKey, "none">) {
    if (overlay !== "completion") {
      onBeforeNonCompletionOverlay?.();
    }
    setActiveOverlay(overlay);
    setQuickOpenQuery("");
    onResetOverlaySearch?.();
    onStatusChange(getOverlayLabel(overlay));
  }

  return {
    filesVisible,
    setFilesVisible,
    leftSidebarWidth,
    bottomContentVisible,
    setBottomContentVisible,
    bottomToolHeight,
    bottomLayoutToken,
    activeLeftTool,
    activeBottomTool,
    activeOverlay,
    setActiveOverlay,
    quickOpenQuery,
    setQuickOpenQuery,
    filesPaneRef,
    bottomToolWindowRef,
    maxBottomToolHeight,
    resizeBottomToolWindow,
    resizeLeftSidebar,
    toggleBottomToolMaxHeight,
    showLeftTool,
    showBottomTool,
    toggleBottomTool,
    hideBottomToolWindow,
    setOverlay,
  };
}
