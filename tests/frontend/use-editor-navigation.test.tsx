import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useEditorNavigation } from "@/components/layout/use-editor-navigation";

describe("useEditorNavigation", () => {
  it("commits successful navigation to back history", async () => {
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

    await act(async () => {
      await result.current.navigateToLocation({ path: "/workspace/B.ets", line: 9, column: 3 }, "Usage");
    });
    rerender({ activePath: "/workspace/B.ets", line: 9 });
    await act(async () => {
      await result.current.navigateBackFromHistory();
    });

    expect(openFile).toHaveBeenLastCalledWith(
      "/workspace/A.ets",
      expect.objectContaining({ parentInteractionId: expect.any(String) }),
    );
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 4, column: 3 }));
    expect(bumpEditorFocusToken).toHaveBeenCalledTimes(2);
    expect(onStatusChange).toHaveBeenLastCalledWith("Back: A.ets:4:3");
  });

  it("navigates forward after going back", async () => {
    const openFile = vi.fn(async () => undefined);
    const onStatusChange = vi.fn();
    const { result, rerender } = renderHook(
      ({ activePath, line, column }) => useEditorNavigation({
        activePath,
        editorSelection: { line, column },
        editorSurfaceRef: createRef<HTMLElement>(),
        openFile,
        setSelectionTarget: vi.fn(),
        bumpEditorFocusToken: vi.fn(),
        onStatusChange,
      }),
      { initialProps: { activePath: "/workspace/A.ets", line: 3, column: 2 } },
    );

    await act(async () => {
      await result.current.navigateToLocation({ path: "/workspace/B.ets", line: 8, column: 4 }, "Usage");
    });
    rerender({ activePath: "/workspace/B.ets", line: 8, column: 4 });
    await act(async () => {
      await result.current.navigateBackFromHistory();
    });
    rerender({ activePath: "/workspace/A.ets", line: 3, column: 2 });
    await act(async () => {
      await result.current.navigateForwardFromHistory();
    });

    expect(openFile).toHaveBeenLastCalledWith(
      "/workspace/B.ets",
      expect.objectContaining({ parentInteractionId: expect.any(String) }),
    );
    expect(onStatusChange).toHaveBeenLastCalledWith("Forward: B.ets:8:4");
  });

  it("navigates within the active file without reopening it", async () => {
    const openFile = vi.fn(async () => undefined);
    const cancelPendingOpen = vi.fn();
    const setSelectionTarget = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/A.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile,
      cancelPendingOpen,
      setSelectionTarget,
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
    }));

    await act(async () => {
      await result.current.navigateToLocation({ path: "/workspace/A.ets", line: 7, column: 2 }, "Usage");
    });

    expect(openFile).not.toHaveBeenCalled();
    expect(cancelPendingOpen).toHaveBeenCalledTimes(1);
    expect(setSelectionTarget).toHaveBeenCalledWith(expect.objectContaining({ line: 7, column: 2 }));
    expect(onStatusChange).toHaveBeenCalledWith("Usage: A.ets:7:2");
  });

  it("keeps the latest navigation target when older file open finishes later", async () => {
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const openFile = vi.fn((path: string) => path.endsWith("A.ets") ? first.promise : second.promise);
    const setSelectionTarget = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/Current.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile,
      setSelectionTarget,
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
    }));

    void act(() => {
      void result.current.navigateToLocation({ path: "/workspace/A.ets", line: 4, column: 2 }, "Usage");
      void result.current.navigateToLocation({ path: "/workspace/B.ets", line: 9, column: 3 }, "Usage");
    });
    await act(async () => {
      second.resolve();
      await Promise.resolve();
    });

    expect(setSelectionTarget).toHaveBeenLastCalledWith(expect.objectContaining({ line: 9, column: 3 }));

    await act(async () => {
      first.resolve();
      await Promise.resolve();
    });

    expect(setSelectionTarget).toHaveBeenCalledTimes(1);
    expect(onStatusChange).toHaveBeenLastCalledWith("Usage: B.ets:9:3");
  });

  it("does not move the caret when cross-file open fails", async () => {
    const setSelectionTarget = vi.fn();
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/Current.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile: vi.fn(async () => ({ ok: false, errorMessage: "read failed" })),
      setSelectionTarget,
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
    }));

    await act(async () => {
      await result.current.navigateToLocation({ path: "/workspace/Missing.ets", line: 9, column: 3 }, "Definition");
    });

    expect(setSelectionTarget).not.toHaveBeenCalled();
    expect(onStatusChange).toHaveBeenLastCalledWith("Definition failed: Missing.ets read failed");
  });

  it("does not add failed navigation to back history", async () => {
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/Current.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile: vi.fn(async () => ({ ok: false, errorMessage: "read failed" })),
      setSelectionTarget: vi.fn(),
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
    }));

    await act(async () => {
      await result.current.navigateToLocation({ path: "/workspace/Missing.ets", line: 9, column: 3 });
      await result.current.navigateBackFromHistory();
    });

    expect(onStatusChange).toHaveBeenLastCalledWith("Back: no previous location");
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

  it("links file loading and visible selection under one navigation trace", async () => {
    const callbacks: Array<() => void> = [];
    const phase = { finish: vi.fn() };
    const trace = { id: "navigation:7", startPhase: vi.fn(() => phase), finish: vi.fn() };
    const openFile = vi.fn(async () => ({ ok: true }));
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/Current.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile,
      setSelectionTarget: vi.fn(),
      bumpEditorFocusToken: vi.fn(),
      onStatusChange: vi.fn(),
      beginTrace: () => trace,
      scheduleVisibleCommit: (callback) => {
        callbacks.push(callback);
        return () => undefined;
      },
    }));

    await act(async () => {
      await result.current.navigateToLocation(
        { path: "/workspace/Target.ets", line: 8, column: 4 },
        "Definition",
      );
    });
    callbacks.shift()?.();

    expect(openFile).toHaveBeenCalledWith("/workspace/Target.ets", {
      parentInteractionId: trace.id,
    });
    expect(trace.startPhase).toHaveBeenNthCalledWith(1, "openFile");
    expect(trace.startPhase).toHaveBeenNthCalledWith(2, "applySelection");
    expect(trace.startPhase).toHaveBeenNthCalledWith(3, "visibleCommit");
    expect(trace.finish).toHaveBeenCalledWith("ok");
  });

  it("closes the navigation trace when file loading rejects", async () => {
    const phase = { finish: vi.fn() };
    const trace = { id: "navigation:8", startPhase: vi.fn(() => phase), finish: vi.fn() };
    const onStatusChange = vi.fn();
    const { result } = renderHook(() => useEditorNavigation({
      activePath: "/workspace/Current.ets",
      editorSelection: { line: 1, column: 1 },
      editorSurfaceRef: createRef<HTMLElement>(),
      openFile: vi.fn(async () => { throw new Error("disk unavailable"); }),
      setSelectionTarget: vi.fn(),
      bumpEditorFocusToken: vi.fn(),
      onStatusChange,
      beginTrace: () => trace,
    }));

    await act(async () => {
      await result.current.navigateToLocation(
        { path: "/workspace/Target.ets", line: 8, column: 4 },
        "Definition",
      );
    });

    expect(phase.finish).toHaveBeenCalledWith("error", "disk unavailable");
    expect(trace.finish).toHaveBeenCalledWith("error");
    expect(onStatusChange).toHaveBeenCalledWith(
      "Definition failed: Target.ets disk unavailable",
    );
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}
