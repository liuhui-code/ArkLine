import {
  deferForegroundIndexSchedule,
  resetForegroundIndexScheduleGate,
  shouldScheduleForegroundIndex,
} from "@/components/layout/foreground-index-schedule-gate";

describe("foreground index schedule gate", () => {
  afterEach(() => {
    resetForegroundIndexScheduleGate();
  });

  it("defers background dispatch until the browser is idle", async () => {
    let idleCallback: (() => void) | undefined;
    const dispatch = vi.fn(async () => undefined);

    deferForegroundIndexSchedule(dispatch, {
      requestIdleCallback: (callback) => {
        idleCallback = callback;
        return 1;
      },
      setTimeout: vi.fn(),
    });

    expect(dispatch).not.toHaveBeenCalled();
    idleCallback?.();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("deduplicates only an identical readiness hint during a rapid interaction burst", () => {
    const rootPath = "/workspace";

    expect(shouldScheduleForegroundIndex("visible", rootPath, "/workspace/src/A.ets", 1_000)).toBe(true);
    expect(shouldScheduleForegroundIndex("completion", rootPath, "/workspace/src/B.ets", 1_200)).toBe(true);
    expect(shouldScheduleForegroundIndex("visible", rootPath, "/workspace/src/A.ets", 1_400)).toBe(false);
  });

  it("allows the next readiness hint after the workspace cooldown", () => {
    const rootPath = "/workspace";

    expect(shouldScheduleForegroundIndex("completion", rootPath, "/workspace/src/A.ets", 1_000)).toBe(true);
    expect(shouldScheduleForegroundIndex("completion", rootPath, "/workspace/src/B.ets", 6_000)).toBe(true);
  });
});
