import { describe, expect, it } from "vitest";
import { createSearchResultWindow } from "@/features/search/search-result-window";

describe("createSearchResultWindow", () => {
  it("returns an empty window for empty results", () => {
    expect(createSearchResultWindow([], 0)).toEqual({
      items: [],
      start: 0,
      end: 0,
      total: 0,
    });
  });

  it("keeps the selected item inside a bounded result window", () => {
    const window = createSearchResultWindow(Array.from({ length: 100 }, (_, index) => index), 50, 2);
    expect(window.start).toBe(48);
    expect(window.end).toBe(53);
    expect(window.items.map((item) => item.index)).toEqual([48, 49, 50, 51, 52]);
    expect(window.items[2]).toEqual({ item: 50, index: 50 });
  });

  it("clamps selection near result edges", () => {
    expect(createSearchResultWindow([1, 2, 3], -10, 1).items.map((item) => item.index)).toEqual([0, 1]);
    expect(createSearchResultWindow([1, 2, 3], 99, 1).items.map((item) => item.index)).toEqual([1, 2]);
  });
});
