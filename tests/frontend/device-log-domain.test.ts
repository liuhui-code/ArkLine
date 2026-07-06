import { describe, expect, it } from "vitest";
import { applyDeviceLogFilter, compileDeviceLogFilter } from "@/features/device-log/device-log-filter";
import { parseDeviceLogLine } from "@/features/device-log/device-log-parser";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
import { buildDeviceLogQueryRequest, findDeviceLogHighlights, queryRowToDeviceLogEntry } from "@/features/device-log/device-log-query";
import { createDeviceLogRetryState, nextDeviceLogRetry, resetDeviceLogRetry } from "@/features/device-log/device-log-retry-policy";
import type { DeviceLogFilterState } from "@/features/device-log/device-log-model";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

const emptyFilter: DeviceLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  levels: [],
  pid: "",
  process: "",
  domain: "",
  tag: "",
};

describe("device log parser", () => {
  it("parses common HiLog fields and keeps raw text", () => {
    const entry = parseDeviceLogLine("06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: page width changed");

    expect(entry.raw).toContain("page width changed");
    expect(entry.level).toBe("info");
    expect(entry.pid).toBe(1234);
    expect(entry.tid).toBe(5678);
    expect(entry.domain).toBe("C03F00");
    expect(entry.tag).toBe("AppTag");
    expect(entry.process).toBe("com.example.demo");
    expect(entry.message).toBe("page width changed");
  });

  it("keeps unparsed lines visible as raw messages", () => {
    const entry = parseDeviceLogLine("plain boot message");

    expect(entry.level).toBe("unknown");
    expect(entry.message).toBe("plain boot message");
    expect(entry.raw).toBe("plain boot message");
  });
});

describe("device log filter", () => {
  it("matches message text with case-insensitive plain search", () => {
    const entry = parseDeviceLogLine("06-25 15:21:48.123  1234  5678 W C03F00/AppTag com.example.demo: Width changed");
    const compiled = compileDeviceLogFilter({ ...emptyFilter, query: "width" });

    expect(compiled.valid).toBe(true);
    expect(applyDeviceLogFilter(entry, compiled)).toBe(true);
  });

  it("reports invalid regex without matching entries", () => {
    const entry = parseDeviceLogLine("06-25 15:21:48.123  1234  5678 W C03F00/AppTag com.example.demo: Width changed");
    const compiled = compileDeviceLogFilter({ ...emptyFilter, query: "(", regex: true });

    expect(compiled.valid).toBe(false);
    expect(compiled.error).toContain("Invalid regular expression");
    expect(applyDeviceLogFilter(entry, compiled)).toBe(false);
  });

  it("skips local regex filtering on very long messages to keep the UI responsive", () => {
    const entry = parseDeviceLogLine(`06-25 15:21:48.123  1234  5678 W C03F00/AppTag com.example.demo: ${"a".repeat(8_192)} target`);
    const compiled = compileDeviceLogFilter({ ...emptyFilter, query: "target", regex: true });

    expect(compiled.valid).toBe(true);
    expect(applyDeviceLogFilter(entry, compiled)).toBe(false);
  });

  it("filters by level, process, domain, and tag", () => {
    const entry = parseDeviceLogLine("06-25 15:21:48.123  1234  5678 E C03F00/AppTag com.example.demo: failure");
    const compiled = compileDeviceLogFilter({
      ...emptyFilter,
      levels: ["error"],
      process: "demo",
      domain: "C03F00",
      tag: "App",
    });

    expect(compiled.valid).toBe(true);
    expect(applyDeviceLogFilter(entry, compiled)).toBe(true);
  });

  it("rejects invalid pid filters before querying logs", () => {
    const compiled = compileDeviceLogFilter({ ...emptyFilter, pid: "12x" });

    expect(compiled.valid).toBe(false);
    expect(compiled.error).toBe("PID filter must be a number");
  });
});

describe("device log store", () => {
  it("keeps all entries by default so UI virtualization does not drop logs", () => {
    const store = createDeviceLogStore();
    const lines = Array.from({ length: 25_000 }, (_, index) => `line ${index + 1}`);

    store.appendRawLines("device-1", lines);

    expect(store.getState().entries).toHaveLength(25_000);
    expect(store.getState().entries[0].message).toBe("line 1");
    expect(store.getState().entries[24_999].message).toBe("line 25000");
  });

  it("keeps a bounded ring buffer and newest entries", () => {
    const store = createDeviceLogStore({ capacity: 3 });

    store.appendRawLines("device-1", ["one", "two"]);
    store.appendRawLines("device-1", ["three", "four"]);

    expect(store.getState().entries.map((entry) => entry.message)).toEqual(["two", "three", "four"]);
  });

  it("tracks live view evictions separately from persisted backend history", () => {
    const store = createDeviceLogStore({ capacity: 3 });

    store.appendRawLineBatches([
      { deviceId: "device-1", lines: ["one", "two"] },
      { deviceId: "device-1", lines: ["three", "four", "five"] },
    ]);

    expect(store.getState().entries.map((entry) => entry.message)).toEqual(["three", "four", "five"]);
    expect(store.getState().trimmedEntries).toBe(2);
  });

  it("appends multiple raw line batches with one bounded trim", () => {
    const store = createDeviceLogStore({ capacity: 4 });

    store.appendRawLineBatches([
      { deviceId: "device-1", lines: ["one", "two"] },
      { deviceId: "device-1", lines: ["three", "four", "five"] },
    ]);

    expect(store.getState().entries.map((entry) => entry.message)).toEqual(["two", "three", "four", "five"]);
  });

  it("buffers raw lines while paused but does not expose them until resumed", () => {
    const store = createDeviceLogStore({ capacity: 5 });

    store.appendRawLines("device-1", ["one"]);
    store.setPaused(true);
    store.appendRawLines("device-1", ["two"]);
    expect(store.getState().entries.map((entry) => entry.message)).toEqual(["one"]);

    store.setPaused(false);
    expect(store.getState().entries.map((entry) => entry.message)).toEqual(["one", "two"]);
  });

  it("can return only entries received in the recent query window", () => {
    let now = 10_000;
    const store = createDeviceLogStore({ now: () => now });

    store.appendRawLines("device-1", ["old"]);
    now = 69_999;
    store.appendRawLines("device-1", ["fresh"]);
    now = 70_001;

    expect(store.getRecentEntries(60_000).map((entry) => entry.message)).toEqual(["fresh"]);
  });
});

describe("device log query helpers", () => {
  it("builds recent one-minute backend query requests from the active filter", () => {
    const request = buildDeviceLogQueryRequest("stream-1", { ...emptyFilter, query: "width", regex: true });

    expect(request).toMatchObject({
      streamId: "stream-1",
      query: "width",
      regex: true,
      timeRangeMs: 60_000,
      limit: 500,
    });
  });

  it("builds paged backend query requests for older log matches", () => {
    const request = buildDeviceLogQueryRequest("stream-1", { ...emptyFilter, query: "width" }, 42);

    expect(request.cursorSeq).toBe(42);
  });

  it("converts backend query rows into renderable log entries", () => {
    const entry = queryRowToDeviceLogEntry({
      seq: 7,
      receivedAtMs: 70_000,
      raw: "raw line",
      timestamp: "06-25 15:21:48.123",
      level: "error",
      pid: 1234,
      tid: 5678,
      process: "demo",
      domain: "C03F00",
      tag: "AppTag",
      message: "failed",
    }, "device-1");

    expect(entry).toMatchObject({ id: "query-7", deviceId: "device-1", level: "error", message: "failed" });
  });

  it("marks case-insensitive query highlights in log messages", () => {
    const ranges = findDeviceLogHighlights("Width changed width", { query: "width", regex: false, matchCase: false });

    expect(ranges).toEqual([{ start: 0, end: 5 }, { start: 14, end: 19 }]);
  });

  it("marks regex query highlights and ignores invalid regex", () => {
    expect(findDeviceLogHighlights("width=24 height=48", { query: "\\d+", regex: true, matchCase: false })).toEqual([
      { start: 6, end: 8 },
      { start: 16, end: 18 },
    ]);
    expect(findDeviceLogHighlights("width=24", { query: "(", regex: true, matchCase: false })).toEqual([]);
  });

  it("skips regex highlights on very long messages to keep rendering responsive", () => {
    const longMessage = `${"a".repeat(8_192)} target`;

    expect(findDeviceLogHighlights(longMessage, { query: "target", regex: true, matchCase: false })).toEqual([]);
  });
});

describe("device log retry policy", () => {
  it("uses bounded exponential backoff and stops after the retry budget", () => {
    let state = createDeviceLogRetryState();

    let retry = nextDeviceLogRetry(state);
    expect(retry).toEqual({ delayMs: 2_000, attempt: 1, exhausted: false, state: { attempts: 1 } });
    state = retry.state;

    retry = nextDeviceLogRetry(state);
    expect(retry).toEqual({ delayMs: 4_000, attempt: 2, exhausted: false, state: { attempts: 2 } });
    state = retry.state;

    retry = nextDeviceLogRetry(state);
    expect(retry).toEqual({ delayMs: 8_000, attempt: 3, exhausted: false, state: { attempts: 3 } });
    state = retry.state;

    retry = nextDeviceLogRetry(state);
    expect(retry).toMatchObject({ delayMs: null, attempt: 3, exhausted: true });
  });

  it("resets the retry budget after a successful stream start", () => {
    const failedOnce = nextDeviceLogRetry(createDeviceLogRetryState()).state;

    const retry = nextDeviceLogRetry(resetDeviceLogRetry(failedOnce));

    expect(retry).toEqual({ delayMs: 2_000, attempt: 1, exhausted: false, state: { attempts: 1 } });
  });
});

describe("device log workspace api demo implementation", () => {
  it("lists demo devices and exposes stream controls outside Tauri", async () => {
    const devices = await defaultWorkspaceApi.listDeviceLogDevices();

    expect(devices[0]).toMatchObject({
      id: "demo-device",
      label: "Demo HarmonyOS Device",
      status: "online",
    });

    const stream = await defaultWorkspaceApi.startDeviceLogStream({ deviceId: devices[0].id });
    expect(stream.streamId).toBe("demo-device-log-stream");
    await expect(defaultWorkspaceApi.stopDeviceLogStream(stream.streamId)).resolves.toBeUndefined();
  });
});
