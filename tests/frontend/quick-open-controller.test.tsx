import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { QuickOpenPanel } from "@/components/layout/QuickOpenPanel";
import { useQuickOpenController } from "@/components/layout/use-quick-open-controller";

describe("Quick Open", () => {
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
    fireEvent.mouseEnter(screen.getByRole("button", { name: "/Page0.ets" }));

    expect(onMoveSelection).toHaveBeenCalledWith(-1);
    expect(onOpenResult).toHaveBeenCalledWith("/Page1.ets");
    expect(onSelectResult).toHaveBeenCalledWith(0);
  });
});
