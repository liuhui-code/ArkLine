import { describe, expect, it, vi } from "vitest";
import { EDITOR_TARGET_READINESS_SCRIPT } from "../../scripts/packaged-soak-readiness.mjs";
import {
  exerciseQuickOpen,
  verifySearchEverywhereClass,
} from "../../scripts/packaged-soak-search-workload.mjs";

describe("packaged Quick Open workload", () => {
  it("verifies class search through Double Shift while indexing continues", async () => {
    const driver = createDriver();

    await expect(verifySearchEverywhereClass(driver, "Page000000")).resolves.toBeUndefined();

    expect(driver.keyChord).toHaveBeenNthCalledWith(1, ["\uE008"]);
    expect(driver.keyChord).toHaveBeenNthCalledWith(2, ["\uE008"]);
    expect(driver.typeText).toHaveBeenCalledWith("Page000000");
    expect(driver.keyChord).toHaveBeenLastCalledWith(["\uE00C"]);
  });

  it("waits for target editor content before recording navigation", async () => {
    const driver = createDriver();
    const jumps: number[] = [];
    const counters = { searchMissCount: 0, quickOpenMissCount: 0, staleApplyCount: 0 };

    await expect(exerciseQuickOpen(
      driver,
      0,
      jumps,
      counters,
      [],
      {
        kind: "real-workspace",
        findQueries: ["build"],
        quickOpenTargets: [{
          query: "Index",
          title: "Index.ets",
          editorNeedle: "struct Index",
        }],
      },
    )).resolves.toBe(true);

    expect(jumps).toEqual([30]);
    expect(driver.executeAsync).toHaveBeenCalledWith(
      EDITOR_TARGET_READINESS_SCRIPT,
      ["struct Index", 10_000],
      11_000,
    );
    expect(counters.staleApplyCount).toBe(0);
  });
});

function createDriver() {
  return {
    keyChord: vi.fn(async () => undefined),
    waitForSelectorPresent: vi.fn(async () => undefined),
    typeText: vi.fn(async () => undefined),
    execute: vi.fn(async (script: string, args?: unknown[]) => {
      if (script.includes("interactionStarts")) return 100;
      if (script.includes('label === "activeTab"')) {
        return { title: "Index.ets", at: 120 };
      }
      return { phase: args?.[0], resultCount: 1 };
    }),
    executeAsync: vi.fn(async (script: string) => {
      if (script === EDITOR_TARGET_READINESS_SCRIPT) {
        return { matched: true, at: 130 };
      }
      return { at: 110, count: 1, query: "Index" };
    }),
  };
}
