import { readFileSync } from "node:fs";

const appCss = readFileSync("src/styles/app.css", "utf8");

describe("editor column ruler", () => {
  it("keeps application surface colors from resetting the ruler background image", () => {
    const contentSurfaceRule = [...appCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)].find((match) => {
      const selectors = match[1].split(",").map((selector) => selector.trim());
      return selectors.includes(".editor-codemirror .cm-editor")
        && selectors.includes(".editor-codemirror .cm-scroller")
        && selectors.includes(".editor-codemirror .cm-content");
    });

    expect(contentSurfaceRule).toBeDefined();
    expect(contentSurfaceRule?.[2]).toMatch(/background-color:\s*#1f2329/);
    expect(contentSurfaceRule?.[2]).not.toMatch(/(?:^|;)\s*background\s*:/);
  });
});
