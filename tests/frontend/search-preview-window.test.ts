import { describe, expect, it } from "vitest";
import { createSearchPreviewWindow } from "@/features/search/search-preview-window";

describe("createSearchPreviewWindow", () => {
  it("returns every line when the file is smaller than the preview budget", () => {
    const window = createSearchPreviewWindow(["a", "b", "c"], 2, 2);

    expect(window.totalLines).toBe(3);
    expect(window.lines).toEqual([
      { lineNumber: 1, text: "a" },
      { lineNumber: 2, text: "b" },
      { lineNumber: 3, text: "c" },
    ]);
  });

  it("centers a large preview window around the hit line", () => {
    const lines = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`);
    const window = createSearchPreviewWindow(lines, 50, 2);

    expect(window.totalLines).toBe(100);
    expect(window.lines.map((line) => line.lineNumber)).toEqual([48, 49, 50, 51, 52]);
  });

  it("clamps a hit near the beginning", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const window = createSearchPreviewWindow(lines, 1, 2);

    expect(window.lines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
  });

  it("clamps a hit near the end", () => {
    const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const window = createSearchPreviewWindow(lines, 20, 2);

    expect(window.lines.map((line) => line.lineNumber)).toEqual([18, 19, 20]);
  });
});
