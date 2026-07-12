import { describe, expect, it } from "vitest";
import {
  buildDeviceLogLiveWindowText,
  buildDeviceLogRenderWindow,
  createStatsPollingErrorStats,
} from "@/components/layout/device-log-panel-model";
import type { DeviceLogEntry } from "@/features/device-log/device-log-model";

describe("device log panel model", () => {
  it("keeps the rendered log window pinned to the tail while following", () => {
    const entries = Array.from({ length: 100 }, (_, index) => entry(index));

    const window = buildDeviceLogRenderWindow({
      entries,
      followingTail: true,
      rowHeight: 10,
      overscan: 2,
      scrollTop: 0,
      viewportHeight: 50,
    });

    expect(window.visibleStartIndex).toBe(91);
    expect(window.renderedEntries.map((item) => item.id)).toEqual(["91", "92", "93", "94", "95", "96", "97", "98", "99"]);
    expect(window.virtualTop).toBe(910);
    expect(window.virtualHeight).toBe(1000);
  });

  it("uses scroll position when the user is not following the tail", () => {
    const entries = Array.from({ length: 30 }, (_, index) => entry(index));

    const window = buildDeviceLogRenderWindow({
      entries,
      followingTail: false,
      rowHeight: 10,
      overscan: 2,
      scrollTop: 80,
      viewportHeight: 40,
    });

    expect(window.visibleStartIndex).toBe(6);
    expect(window.renderedEntries[0]?.id).toBe("6");
  });

  it("formats live window text and stats polling errors", () => {
    expect(buildDeviceLogLiveWindowText({
      liveEntryCount: 10,
      sourceEntryCount: 100,
      trimmedEntries: 25,
      visibleEntryCount: 8,
      queryActive: false,
    })).toBe("10 live · 25 older persisted");

    expect(buildDeviceLogLiveWindowText({
      liveEntryCount: 10,
      sourceEntryCount: 100,
      trimmedEntries: 25,
      visibleEntryCount: 8,
      queryActive: true,
    })).toBe("100 total · 8 matched");

    expect(createStatsPollingErrorStats("stream-1", "device-1", new Error("boom"))).toMatchObject({
      streamId: "stream-1",
      deviceId: "device-1",
      streamStatus: "error",
      lastError: "boom",
    });
  });
});

function entry(index: number): DeviceLogEntry {
  return {
    id: String(index),
    deviceId: "device-1",
    raw: `line ${index}`,
    receivedAt: index,
    timestamp: null,
    level: "info",
    pid: null,
    tid: null,
    process: "",
    domain: "",
    tag: "",
    message: `line ${index}`,
  };
}
