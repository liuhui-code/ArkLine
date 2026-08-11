import {
  resetForegroundIndexScheduleGate,
  shouldScheduleForegroundIndex,
} from "@/components/layout/foreground-index-schedule-gate";

describe("foreground index schedule gate", () => {
  afterEach(() => {
    resetForegroundIndexScheduleGate();
  });

  it("admits one readiness hint per workspace during a rapid interaction burst", () => {
    const rootPath = "/workspace";

    expect(shouldScheduleForegroundIndex("visible", rootPath, "/workspace/src/A.ets", 1_000)).toBe(true);
    expect(shouldScheduleForegroundIndex("completion", rootPath, "/workspace/src/B.ets", 1_200)).toBe(false);
    expect(shouldScheduleForegroundIndex("navigation", rootPath, "/workspace/src/C.ets", 1_400)).toBe(false);
  });

  it("allows the next readiness hint after the workspace cooldown", () => {
    const rootPath = "/workspace";

    expect(shouldScheduleForegroundIndex("completion", rootPath, "/workspace/src/A.ets", 1_000)).toBe(true);
    expect(shouldScheduleForegroundIndex("completion", rootPath, "/workspace/src/B.ets", 6_000)).toBe(true);
  });
});
