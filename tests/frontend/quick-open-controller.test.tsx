import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { QuickOpenPanel } from "@/components/layout/QuickOpenPanel";
import { useQuickOpenController } from "@/components/layout/use-quick-open-controller";

describe("Quick Open", () => {
  it("queries files through the readiness broker with a generation and deadline", async () => {
    const queryWorkspaceWithReadiness = vi.fn(async () => ({
      items: [{
        id: "file:/workspace/Entry.ets",
        source: "file" as const,
        kind: "file" as const,
        title: "Entry.ets",
        subtitle: "/workspace/Entry.ets",
        path: "/workspace/Entry.ets",
        score: 100,
        freshness: "ready" as const,
      }],
      readiness: {
        rootPath: "/workspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
    }));
    const { result } = renderHook(() => useQuickOpenController({
      active: true,
      rootPath: "/workspace",
      query: "Entry",
      localResults: [{ path: "/workspace/LocalEntry.ets" }],
      queryWorkspaceWithReadiness,
    }));

    await waitFor(() => expect(result.current.results).toEqual([
      { path: "/workspace/Entry.ets" },
    ]));
    expect(queryWorkspaceWithReadiness).toHaveBeenCalledWith(
      "/workspace",
      "Entry",
      "files",
      20,
      null,
      undefined,
      1,
      1_000,
      "quickOpen",
    );
  });

  it("cancels only the active Quick Open query lane", async () => {
    const queryWorkspaceWithReadiness = vi.fn(
      () => new Promise<ReturnType<typeof missingQuickOpenEnvelope>>(() => undefined),
    );
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const { rerender } = renderHook(
      ({ active }) => useQuickOpenController({
        active,
        rootPath: "/workspace",
        query: "Entry",
        localResults: [],
        queryWorkspaceWithReadiness,
        cancelWorkspaceSearch,
      }),
      { initialProps: { active: true } },
    );

    await waitFor(() => expect(queryWorkspaceWithReadiness).toHaveBeenCalled());
    rerender({ active: false });

    await waitFor(() => expect(cancelWorkspaceSearch).toHaveBeenCalledWith(
      "/workspace",
      "quickOpen",
      1,
    ));
  });

  it("queries the persistent workspace index when the local projection is empty", async () => {
    const queryWorkspace = vi.fn(async () => [{
      id: "file:/workspace/Page000000.ets",
      source: "file" as const,
      kind: "file",
      title: "Page000000.ets",
      subtitle: "/workspace/Page000000.ets",
      path: "/workspace/Page000000.ets",
      line: 1,
      column: 1,
      score: 120,
      freshness: "ready" as const,
    }]);
    const { result } = renderHook(() => useQuickOpenController({
      active: true,
      rootPath: "/workspace",
      query: "Page000000",
      localResults: [],
      queryWorkspace,
    }));

    await waitFor(() => expect(result.current.results).toEqual([
      { path: "/workspace/Page000000.ets" },
    ]));
    expect(queryWorkspace).toHaveBeenCalledWith(
      "/workspace",
      "Page000000",
      20,
    );
  });

  it("loads a bounded persistent file catalog for an empty query", async () => {
    const queryWorkspace = vi.fn(async () => [{
      id: "file:/workspace/Entry.ets",
      source: "file" as const,
      kind: "file",
      title: "Entry.ets",
      subtitle: "/workspace/Entry.ets",
      path: "/workspace/Entry.ets",
      score: 100,
      freshness: "ready" as const,
    }]);
    const { result } = renderHook(() => useQuickOpenController({
      active: true,
      rootPath: "/workspace",
      query: "",
      localResults: [],
      queryWorkspace,
    }));

    await waitFor(() => expect(result.current.results).toEqual([
      { path: "/workspace/Entry.ets" },
    ]));
    expect(queryWorkspace).toHaveBeenCalledWith("/workspace", "", 20);
  });

  it("ignores a stale persistent query response", async () => {
    let resolveFirst: ((value: never[]) => void) | null = null;
    const queryWorkspace = vi.fn((_: string, query: string) => {
      if (query === "Page0") {
        return new Promise<never[]>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve([{
        id: "file:/workspace/Page1.ets",
        source: "file" as const,
        kind: "file",
        title: "Page1.ets",
        subtitle: "/workspace/Page1.ets",
        path: "/workspace/Page1.ets",
        score: 120,
        freshness: "ready" as const,
      }]);
    });
    const { result, rerender } = renderHook(
      ({ query }) => useQuickOpenController({
        active: true,
        rootPath: "/workspace",
        query,
        localResults: [],
        queryWorkspace,
      }),
      { initialProps: { query: "Page0" } },
    );

    await waitFor(() => expect(queryWorkspace).toHaveBeenCalledWith(
      "/workspace",
      "Page0",
      20,
    ));
    rerender({ query: "Page1" });
    await waitFor(() => expect(result.current.results).toEqual([
      { path: "/workspace/Page1.ets" },
    ]));
    await act(async () => resolveFirst?.([]));

    expect(result.current.results).toEqual([
      { path: "/workspace/Page1.ets" },
    ]);
  });

  it("does not expose partial local candidates while the persistent query is pending", async () => {
    let resolveQuery: ((value: never[]) => void) | null = null;
    const queryWorkspace = vi.fn(() => new Promise<never[]>((resolve) => {
      resolveQuery = resolve;
    }));
    const { result } = renderHook(() => useQuickOpenController({
      active: true,
      rootPath: "/workspace",
      query: "Page000067",
      localResults: [{ path: "/workspace/Page000679.ets" }],
      queryWorkspace,
    }));

    expect(result.current.results).toEqual([]);
    await waitFor(() => expect(queryWorkspace).toHaveBeenCalled());
    await act(async () => resolveQuery?.([]));
    expect(result.current.results).toEqual([]);
  });

  it("uses the hot file catalog after a non-ready persistent index returns empty", async () => {
    const queryLocal = vi.fn(() => [{ path: "/workspace/Visible.ets" }]);
    const queryWorkspaceWithReadiness = vi.fn(async () => ({
      items: [],
      readiness: {
        rootPath: "/workspace",
        requestedGeneration: 1,
        servedGeneration: null,
        state: "missing" as const,
        retryable: true,
      },
    }));
    const { result } = renderHook(() => useQuickOpenController({
      active: true,
      rootPath: "/workspace",
      query: "Visible",
      localResults: [],
      queryLocal,
      queryWorkspaceWithReadiness,
    }));

    expect(queryLocal).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.results).toEqual([
      { path: "/workspace/Visible.ets" },
    ]));
    expect(queryLocal).toHaveBeenCalledWith("Visible");
  });

  it("keeps the confirmed hot-catalog fallback responsive while the next query is pending", async () => {
    let resolveNext: ((value: ReturnType<typeof missingQuickOpenEnvelope>) => void) | null = null;
    const queryLocal = vi.fn((query: string) => [{ path: `/workspace/${query}.ets` }]);
    const queryWorkspaceWithReadiness = vi.fn((_rootPath: string, query: string) => {
      if (query === "VisibleNext") {
        return new Promise<ReturnType<typeof missingQuickOpenEnvelope>>((resolve) => {
          resolveNext = resolve;
        });
      }
      return Promise.resolve(missingQuickOpenEnvelope());
    });
    const { result, rerender } = renderHook(
      ({ query }) => useQuickOpenController({
        active: true,
        rootPath: "/workspace",
        query,
        localResults: [],
        queryLocal,
        queryWorkspaceWithReadiness,
      }),
      { initialProps: { query: "Visible" } },
    );

    await waitFor(() => expect(result.current.results).toEqual([
      { path: "/workspace/Visible.ets" },
    ]));
    rerender({ query: "VisibleNext" });

    expect(result.current.results).toEqual([{ path: "/workspace/VisibleNext.ets" }]);
    await waitFor(() => expect(queryWorkspaceWithReadiness).toHaveBeenCalledTimes(2));
    await act(async () => resolveNext?.(missingQuickOpenEnvelope()));
  });

  it("opens the keyboard-selected result and tracks pointer selection", () => {
    const onMoveSelection = vi.fn();
    const onSelectResult = vi.fn();
    const onOpenResult = vi.fn();
    render(
      <QuickOpenPanel
        query="Page"
        results={[{ path: "/Page0.ets" }, { path: "/Page1.ets" }]}
        selectedIndex={1}
        onChangeQuery={vi.fn()}
        onMoveSelection={onMoveSelection}
        onSelectResult={onSelectResult}
        onOpenResult={onOpenResult}
        onClose={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("Quick Open Query");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent.keyDown(input, { key: "Enter" });
    const firstResult = screen.getByRole("button", { name: "/Page0.ets" });
    fireEvent.mouseEnter(firstResult);

    expect(onMoveSelection).toHaveBeenCalledWith(-1);
    expect(onOpenResult).toHaveBeenCalledWith("/Page1.ets");
    expect(onSelectResult).not.toHaveBeenCalled();

    fireEvent.mouseMove(firstResult);
    expect(onSelectResult).toHaveBeenCalledWith(0);
  });

  it("keeps rapid filename typing local and commits only the final query", () => {
    vi.useFakeTimers();
    const onChangeQuery = vi.fn();
    render(
      <QuickOpenPanel
        query=""
        results={[]}
        selectedIndex={0}
        onChangeQuery={onChangeQuery}
        onMoveSelection={vi.fn()}
        onSelectResult={vi.fn()}
        onOpenResult={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Quick Open Query");

    for (const value of ["P", "Pa", "Pag", "Page", "Page0"]) {
      fireEvent.change(input, { target: { value } });
    }

    expect(input).toHaveValue("Page0");
    expect(onChangeQuery).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(39));
    expect(onChangeQuery).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChangeQuery).toHaveBeenCalledTimes(1);
    expect(onChangeQuery).toHaveBeenCalledWith("Page0");
    vi.useRealTimers();
  });

  it("commits a pending filename instead of opening a stale result", () => {
    vi.useFakeTimers();
    const onChangeQuery = vi.fn();
    const onOpenResult = vi.fn();
    render(
      <QuickOpenPanel
        query="Page0"
        results={[{ path: "/Page0.ets" }]}
        selectedIndex={0}
        onChangeQuery={onChangeQuery}
        onMoveSelection={vi.fn()}
        onSelectResult={vi.fn()}
        onOpenResult={onOpenResult}
        onClose={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Quick Open Query");

    fireEvent.change(input, { target: { value: "Page1" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChangeQuery).toHaveBeenCalledWith("Page1");
    expect(onOpenResult).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(onChangeQuery).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("exposes the committed filename on the result surface", () => {
    render(
      <QuickOpenPanel
        query="Page000097"
        results={[{ path: "/Page000097.ets" }]}
        selectedIndex={0}
        onChangeQuery={vi.fn()}
        onMoveSelection={vi.fn()}
        onSelectResult={vi.fn()}
        onOpenResult={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole("list", { name: "Quick Open Results" }))
      .toHaveAttribute("data-query", "Page000097");
  });
});

function missingQuickOpenEnvelope() {
  return {
    items: [],
    readiness: {
      rootPath: "/workspace",
      requestedGeneration: 1,
      servedGeneration: null,
      state: "missing" as const,
      retryable: true,
    },
  };
}
