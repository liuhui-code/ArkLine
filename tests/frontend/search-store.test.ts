import { createSearchStore } from "@/features/search/search-store";

describe("search store", () => {
  it("ignores results from a cancelled request", () => {
    const store = createSearchStore();
    const first = store.begin("Entry");
    store.cancel();

    store.receive(first, {
      path: "entry/src/main/ets/pages/Index.ets",
      line: 1,
      column: 1,
      text: "@Entry",
    });

    expect(store.state.results).toEqual([]);
    expect(store.state.status).toBe("cancelled");
  });

  it("groups accepted results by path", () => {
    const store = createSearchStore();
    const request = store.begin("Component");
    store.receive(request, { path: "a.ets", line: 2, column: 1, text: "@Component" });
    store.receive(request, { path: "a.ets", line: 8, column: 1, text: "Component" });
    store.finish(request);

    expect(store.groupedResults()).toEqual([{ path: "a.ets", matches: store.state.results }]);
    expect(store.state.status).toBe("complete");
  });
});
