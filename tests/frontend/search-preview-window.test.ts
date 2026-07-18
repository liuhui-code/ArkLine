import { describe, expect, it } from "vitest";
import {
  createSearchPreviewDocument,
  createSearchPreviewWindow,
  createSearchPreviewWindowFromDocument,
  createSearchPreviewWindowFromContent,
} from "@/features/search/search-preview-window";

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

  it("extracts a bounded window directly from file content", () => {
    const content = Array.from({ length: 100 }, (_, index) => `line ${index + 1}`).join("\n");
    const window = createSearchPreviewWindowFromContent(content, 50, 2);

    expect(window.totalLines).toBe(100);
    expect(window.lines).toEqual([
      { lineNumber: 48, text: "line 48" },
      { lineNumber: 49, text: "line 49" },
      { lineNumber: 50, text: "line 50" },
      { lineNumber: 51, text: "line 51" },
      { lineNumber: 52, text: "line 52" },
    ]);
  });

  it("normalizes CRLF preview lines without allocating the full line list", () => {
    const window = createSearchPreviewWindowFromContent("a\r\nb\r\nc", 2, 1);

    expect(window.totalLines).toBe(3);
    expect(window.lines).toEqual([
      { lineNumber: 1, text: "a" },
      { lineNumber: 2, text: "b" },
      { lineNumber: 3, text: "c" },
    ]);
  });

  it("treats empty content as one visible empty line", () => {
    expect(createSearchPreviewWindowFromContent("", 1, 1)).toEqual({
      totalLines: 1,
      lines: [{ lineNumber: 1, text: "" }],
    });
  });

  it("reuses one line index for multiple hit windows in the same file", () => {
    const content = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
    const document = createSearchPreviewDocument(content);

    const first = createSearchPreviewWindowFromDocument(document, 40, 1);
    const second = createSearchPreviewWindowFromDocument(document, 160, 1);

    expect(document.content).toBe(content);
    expect(document.lineStarts).toHaveLength(200);
    expect(first.lines.map((line) => line.lineNumber)).toEqual([39, 40, 41]);
    expect(second.lines.map((line) => line.lineNumber)).toEqual([159, 160, 161]);
  });
});
