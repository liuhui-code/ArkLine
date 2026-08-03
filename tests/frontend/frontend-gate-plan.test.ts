import { describe, expect, it } from "vitest";
import { collectNamedTests, createTestNameBatches } from "../../scripts/frontend-gate-plan.mjs";

describe("frontend gate plan", () => {
  it("collects literal test names from TSX without matching unrelated calls", () => {
    const source = `
      describe("Shell", () => {
        it("opens completion", () => undefined);
        test('closes completion', () => undefined);
        helper("not a test");
      });
    `;

    expect(collectNamedTests(source)).toEqual(["opens completion", "closes completion"]);
  });

  it("creates exhaustive non-overlapping exact-name batches", () => {
    const batches = createTestNameBatches("App shell", [
      "opens completion",
      "matches file.ts",
      "uses (fallback)",
    ], 2).map((pattern: string) => new RegExp(pattern));
    const fullNames = [
      "App shell opens completion",
      "App shell matches file.ts",
      "App shell uses (fallback)",
    ];

    expect(batches).toHaveLength(2);
    expect(fullNames.map((name) => batches.filter((batch: RegExp) => batch.test(name)).length)).toEqual([1, 1, 1]);
    expect(batches.some((batch: RegExp) => batch.test("App shell matches fileXts"))).toBe(false);
  });

  it("rejects invalid batch sizes", () => {
    expect(() => createTestNameBatches("Shell", ["test"], 0)).toThrow(/positive integer/u);
  });
});
