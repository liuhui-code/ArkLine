import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useShellLayoutState } from "@/components/layout/use-shell-layout-state";

describe("useShellLayoutState", () => {
  it("resizes shell panes within stable bounds", () => {
    const { result } = renderHook(() => useShellLayoutState(options()));

    act(() => result.current.resizeLeftSidebar(10));
    expect(result.current.leftSidebarWidth).toBe(220);

    act(() => result.current.resizeLeftSidebar(999));
    expect(result.current.leftSidebarWidth).toBe(520);

    act(() => result.current.resizeBottomToolWindow(40));
    expect(result.current.bottomToolHeight).toBe(160);
    expect(result.current.bottomLayoutToken).toBe(1);
  });

  it("toggles bottom tools and restores editor focus when closed", () => {
    const onStatusChange = vi.fn();
    const onFocusEditorSoon = vi.fn();
    const { result } = renderHook(() => useShellLayoutState(options({ onStatusChange, onFocusEditorSoon })));

    act(() => result.current.showBottomTool("terminal"));
    expect(result.current.activeBottomTool).toBe("terminal");
    expect(result.current.bottomContentVisible).toBe(true);
    expect(onStatusChange).toHaveBeenLastCalledWith("Terminal");

    act(() => result.current.toggleBottomTool("terminal"));
    expect(result.current.bottomContentVisible).toBe(false);
    expect(onStatusChange).toHaveBeenLastCalledWith("Editor");
    expect(onFocusEditorSoon).toHaveBeenCalledTimes(1);
  });

  it("toggles project tool visibility", () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useShellLayoutState(options({ onStatusChange })));

    act(() => result.current.showLeftTool("project"));
    expect(result.current.filesVisible).toBe(false);
    expect(onStatusChange).toHaveBeenLastCalledWith("Editor");

    act(() => result.current.showLeftTool("project"));
    expect(result.current.filesVisible).toBe(true);
    expect(onStatusChange).toHaveBeenLastCalledWith("Project");
  });

  it("opens overlays and resets search state", () => {
    const onBeforeNonCompletionOverlay = vi.fn();
    const onResetOverlaySearch = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useShellLayoutState(options({
      onBeforeNonCompletionOverlay,
      onResetOverlaySearch,
      onStatusChange,
    })));

    act(() => result.current.setQuickOpenQuery("Entry"));
    act(() => result.current.setOverlay("quickOpen"));

    expect(result.current.activeOverlay).toBe("quickOpen");
    expect(result.current.quickOpenQuery).toBe("");
    expect(onBeforeNonCompletionOverlay).toHaveBeenCalledTimes(1);
    expect(onResetOverlaySearch).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenLastCalledWith("Quick Open");
  });
});

function options(overrides: Partial<Parameters<typeof useShellLayoutState>[0]> = {}) {
  return {
    onStatusChange: vi.fn(),
    onFocusEditorSoon: vi.fn(),
    ...overrides,
  };
}
