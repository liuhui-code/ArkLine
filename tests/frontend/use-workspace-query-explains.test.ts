import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWorkspaceQueryExplains } from "@/features/workspace/use-workspace-query-explains";

describe("useWorkspaceQueryExplains", () => {
  it("records explain evidence and updates the rendered snapshot", () => {
    const { result } = renderHook(() => useWorkspaceQueryExplains());

    act(() => {
      expect(result.current.recordRecentQueryExplain({
        kind: "completion",
        query: "build",
        message: "Completion waits for symbols",
        explain: ["query:completion", "reason:Completion waits for symbols"],
      })).toBe(true);
    });

    expect(result.current.recentQueryExplains).toHaveLength(1);
    expect(result.current.recentQueryExplains[0]).toMatchObject({
      kind: "completion",
      query: "build",
      message: "Completion waits for symbols",
      explain: ["query:completion", "reason:Completion waits for symbols"],
    });
  });

  it("does not update the snapshot for empty explain evidence", () => {
    const { result } = renderHook(() => useWorkspaceQueryExplains());

    act(() => {
      expect(result.current.recordRecentQueryExplain({
        kind: "search",
        query: "missing",
        message: "Search miss",
        explain: [],
      })).toBe(false);
    });

    expect(result.current.recentQueryExplains).toEqual([]);
  });
});
