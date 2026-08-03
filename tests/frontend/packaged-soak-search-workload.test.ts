import { describe, expect, it, vi } from "vitest";
import { INTERACTION_START_SCRIPT } from "../../scripts/packaged-soak-telemetry.mjs";
import {
  exerciseFindInFiles,
  QUERY_VALUE_SCRIPT,
} from "../../scripts/packaged-soak-search-workload.mjs";
import { SEARCH_RESULT_READINESS_SCRIPT } from "../../scripts/packaged-soak-readiness.mjs";
import { WEBDRIVER_KEYS } from "../../scripts/packaged-soak-webdriver.mjs";

describe("packaged Find in Files workload", () => {
  it("deletes the complete query and proves the palette closes", async () => {
    const query = "buildTarget";
    let inputValue: string | null = "";
    const driver = {
      keyChord: vi.fn(async (keys: string[]) => {
        if (keys.includes(WEBDRIVER_KEYS.escape)) inputValue = null;
      }),
      waitForSelectorPresent: vi.fn(),
      typeText: vi.fn(async (text: string) => {
        if (text === query) inputValue = query;
        else if (text === WEBDRIVER_KEYS.arrowDown) return;
        else inputValue = "";
      }),
      execute: vi.fn(async (script: string) => {
        if (script === INTERACTION_START_SCRIPT) return 100;
        if (script === QUERY_VALUE_SCRIPT) return inputValue;
        return { phase: "evidence", resultCount: 1 };
      }),
      executeAsync: vi.fn(async (script: string) => {
        expect(script).toBe(SEARCH_RESULT_READINESS_SCRIPT);
        return { at: 130, count: 1, query };
      }),
    };
    const dispatchSamples: number[] = [];
    const readySamples: number[] = [];
    const counters = { searchMissCount: 0, findInFilesMissCount: 0 };

    await exerciseFindInFiles(
      driver,
      0,
      dispatchSamples,
      readySamples,
      counters,
      [],
      { kind: "real-workspace", findQueries: [query] },
    );

    expect(readySamples).toEqual([30]);
    expect(counters).toEqual({ searchMissCount: 0, findInFilesMissCount: 0 });
    expect(driver.typeText).toHaveBeenCalledWith(
      WEBDRIVER_KEYS.backspace.repeat(query.length),
    );
    expect(inputValue).toBeNull();
  });
});
