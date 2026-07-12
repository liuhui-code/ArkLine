import { describe, expect, it } from "vitest";
import { collectLineCountViolations } from "../../scripts/check-line-count.mjs";

describe("check-line-count", () => {
  it("reports target code files above the configured line limit", () => {
    const files = [
      { path: "src/large.ts", text: Array.from({ length: 4 }, (_, index) => `line ${index}`).join("\n") },
      { path: "src/small.ts", text: "one\ntwo\nthree" },
      { path: "src/style.css", text: "a\nb\nc\nd\ne" },
      { path: "node_modules/pkg/index.ts", text: "a\nb\nc\nd\ne" },
    ];

    expect(collectLineCountViolations(files, { limit: 3 })).toEqual([
      { path: "src/large.ts", lineCount: 4, limit: 3 },
    ]);
  });
});
