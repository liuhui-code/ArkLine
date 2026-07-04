import { describe, expect, it, vi } from "vitest";
import { createWorkspaceQueryExplainStore } from "@/features/workspace/workspace-query-explain-store";

describe("workspace query explain store", () => {
  it("ignores records without explain evidence", () => {
    const store = createWorkspaceQueryExplainStore();

    expect(store.record({
      kind: "search",
      query: "missing",
      message: "Search miss",
      explain: [],
    })).toBe(false);

    expect(store.state).toEqual([]);
  });

  it("stores newest records first with stable metadata", () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(200);
    const store = createWorkspaceQueryExplainStore();

    expect(store.record({
      kind: "definition",
      query: "main.ets:1:1",
      message: "Definition miss",
      explain: ["query:definition", "reason:Index is partial"],
    })).toBe(true);
    expect(store.record({
      kind: "completion",
      query: "build",
      message: "Completion miss",
      explain: ["query:completion", "reason:Completion is partial"],
    })).toBe(true);

    expect(store.state).toEqual([
      {
        id: "completion:200:1",
        kind: "completion",
        query: "build",
        message: "Completion miss",
        explain: ["query:completion", "reason:Completion is partial"],
        createdAt: 200,
      },
      {
        id: "definition:100:0",
        kind: "definition",
        query: "main.ets:1:1",
        message: "Definition miss",
        explain: ["query:definition", "reason:Index is partial"],
        createdAt: 100,
      },
    ]);
  });

  it("keeps only the configured number of records", () => {
    const store = createWorkspaceQueryExplainStore(2);

    store.record({ kind: "search", query: "one", message: "one", explain: ["reason:one"] });
    store.record({ kind: "search", query: "two", message: "two", explain: ["reason:two"] });
    store.record({ kind: "search", query: "three", message: "three", explain: ["reason:three"] });

    expect(store.state.map((item) => item.query)).toEqual(["three", "two"]);
  });
});
