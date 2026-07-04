import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEditorNavigation } from "@/components/layout/use-editor-navigation";

describe("useEditorNavigation", () => {
  it("remembers the current location and navigates back", async () => {
    const openFile = vi.fn(async () => undefined);
    const setSelectionTarget = vi.fn();
    const bumpEditorFocusToken = vi.fn();
    const onStatusChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ activePath, line }) => useEditorNavigation({
        activePath,
        editorSelection: { line, column: 3 },
        editorSurfaceRef: createRef<HTMLElement>(),
        openFile,
        setSelectionTarget,
        bumpEditorFocusToken,
        onStatusChange,
      }),
      { initialProps: { activePath: "/workspace/A.ets", line: 4 } },
    );

    act(() => result.current.rememberCurrentLocation());
    rerender({ activePath: "/workspace/B.ets", line: 9 });
    await act(async () => {
      await result.current.navigateBackFromHistory();
    });

    expect(openFile).toHaveBeenCalledWith("/workspace/A.ets");
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 4, column: 3 }));
    expect(bumpEditorFocusToken).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenCalledWith("Back: A.ets:4:3");
  });

  it("navigates within the active file without reopening it", async () => {
    const openFile = vi.fn(async () => undefined);
    const setSelectionTarget = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/A.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile,
      setSelectionTarget,
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
    }));

    await act(async () => {
      await result.current.navigateToLocation({ path: "/workspace/A.ets", line: 7, column: 2 }, "Usage");
    });

    expect(openFile).not.toHaveBeenCalled();
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 7, column: 2 }));
    expect(onStatusChange).toHaveBeenCalledWith("Usage: A.ets:7:2");
  });

  it("reports when back history is empty", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: null,
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile: vi.fn(async () => undefined),
      setSelectionTarget: vi.fn(),
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
    }));

    await act(async () => {
      await result.current.navigateBackFromHistory();
    });

    expect(onStatusChange).toHaveBeenCalledWith("Back: no previous location");
  });
});
