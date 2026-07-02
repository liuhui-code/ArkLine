import { describe, expect, it } from "vitest";
import { applyDeviceLogFilter, compileDeviceLogFilter } from "@/features/device-log/device-log-filter";
import { parseDeviceLogLine } from "@/features/device-log/device-log-parser";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
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
});

describe("device log store", () => {
  it("keeps a bounded ring buffer and newest entries", () => {
    const store = createDeviceLogStore({ capacity: 3 });

    store.appendRawLines("device-1", ["one", "two"]);
    store.appendRawLines("device-1", ["three", "four"]);

    expect(store.getState().entries.map((entry) => entry.message)).toEqual(["two", "three", "four"]);
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
