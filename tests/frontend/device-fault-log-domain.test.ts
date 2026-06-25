import { describe, expect, it } from "vitest";
import { applyDeviceFaultLogFilter, compileDeviceFaultLogFilter } from "@/features/device-log/device-fault-log-filter";
import type { DeviceFaultLogFetchResult, DeviceFaultLogFilterState } from "@/features/device-log/device-fault-log-model";
import { parseDeviceFaultLogEntries } from "@/features/device-log/device-fault-log-parser";
import { createDeviceFaultLogStore } from "@/features/device-log/device-fault-log-store";

const emptyFilter: DeviceFaultLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  type: "all",
  process: "",
  pid: "",
};

function buildResult(entries: Array<{ id: string; raw: string }>): DeviceFaultLogFetchResult {
  return {
    deviceId: "device-1",
    fetchedAt: "2026-06-25T15:21:48.000Z",
    entries,
    command: "hdc shell faultlog -l",
    stderr: "",
    status: "ready",
    message: "ok",
  };
}

describe("device fault log parser", () => {
  it("classifies js crash and preserves stack lines", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-1",
        raw: [
          "Timestamp: 2026-06-25 15:21:48",
          "Reason: Js Error",
          "Process: com.example.demo",
          "PID: 4321",
          "BundleName: com.example.demo",
          "Summary: Render crashed",
          "Error: TypeError: undefined is not a function",
          "Stacktrace:",
          "  at render (pages/index.ets:12:3)",
          "  at update (pages/app.ets:44:9)",
        ].join("\n"),
      },
    ]));
    const [entry] = parsed.entries;

    expect(parsed).toMatchObject({
      deviceId: "device-1",
      fetchedAt: "2026-06-25T15:21:48.000Z",
      command: "hdc shell faultlog -l",
      stderr: "",
      status: "ready",
      message: "ok",
    });
    expect(entry.type).toBe("jsCrash");
    expect(entry.processName).toBe("com.example.demo");
    expect(entry.pid).toBe(4321);
    expect(entry.bundleName).toBe("com.example.demo");
    expect(entry.summary).toBe("Render crashed");
    expect(entry.reason).toBe("Js Error");
    expect(entry.stack).toEqual([
      "at render (pages/index.ets:12:3)",
      "at update (pages/app.ets:44:9)",
    ]);
    expect(entry.raw).toContain("Stacktrace:");
    expect(entry.deviceId).toBe("device-1");
    expect(entry.rawId).toBe("fault-1");
  });

  it("keeps unknown entries inspectable", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-2",
        raw: "opaque fault blob without structured fields",
      },
    ]));
    const [entry] = parsed.entries;

    expect(entry.type).toBe("unknown");
    expect(entry.summary).toBe("opaque fault blob without structured fields");
    expect(entry.raw).toBe("opaque fault blob without structured fields");
  });

  it("classifies app killed faults conservatively", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-killed",
        raw: [
          "Reason: APP_KILLED",
          "Process: com.example.player",
          "PID: 2468",
          "Summary: Process killed by force stop request",
        ].join("\n"),
      },
    ]));
    const [entry] = parsed.entries;

    expect(entry.type).toBe("appKilled");
    expect(entry.processName).toBe("com.example.player");
    expect(entry.summary).toContain("killed by force stop");
  });

  it("classifies system warnings conservatively", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-warning",
        raw: [
          "Reason: SYS_WARNING",
          "Process: com.example.system",
          "Summary: Watchdog warning detected during thermal check",
        ].join("\n"),
      },
    ]));
    const [entry] = parsed.entries;

    expect(entry.type).toBe("sysWarning");
    expect(entry.severity).toBe("warning");
    expect(entry.summary).toContain("Watchdog warning");
  });

  it("preserves wrapped summary continuation lines", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-summary-wrap",
        raw: [
          "Reason: APP_CRASH",
          "Summary: Native crash while starting camera pipeline",
          "  with extra context from the second wrapped line",
          "Process: com.example.camera",
        ].join("\n"),
      },
    ]));
    const [entry] = parsed.entries;

    expect(entry.type).toBe("cppCrash");
    expect(entry.summary).toBe("Native crash while starting camera pipeline\nwith extra context from the second wrapped line");
  });

  it("does not promote generic prose into freeze or warning fault types", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-generic-prose",
        raw: [
          "Summary: User wrote a note saying the ui freeze felt bad and the warning banner looked noisy.",
          "Process: com.example.notes",
        ].join("\n"),
      },
    ]));
    const [entry] = parsed.entries;

    expect(entry.type).toBe("unknown");
    expect(entry.severity).toBe("unknown");
  });
});

describe("device fault log filter", () => {
  it("matches by type, process, pid, and plain text", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-3",
        raw: [
          "Reason: APP_FREEZE",
          "Process: com.example.camera",
          "PID: 987",
          "Summary: Main thread blocked by image decode",
        ].join("\n"),
      },
    ]));
    const [entry] = parsed.entries;

    const compiled = compileDeviceFaultLogFilter({
      ...emptyFilter,
      query: "image decode",
      type: "appFreeze",
      process: "camera",
      pid: "987",
    });

    expect(compiled.valid).toBe(true);
    expect(applyDeviceFaultLogFilter(entry, compiled)).toBe(true);
  });

  it("reports invalid regex and does not match", () => {
    const parsed = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-4",
        raw: "Summary: crash while starting",
      },
    ]));
    const [entry] = parsed.entries;

    const compiled = compileDeviceFaultLogFilter({
      ...emptyFilter,
      query: "(",
      regex: true,
    });

    expect(compiled.valid).toBe(false);
    expect(compiled.error).toContain("Invalid regular expression");
    expect(applyDeviceFaultLogFilter(entry, compiled)).toBe(false);
  });
});

describe("device fault log store", () => {
  it("selects the first entry after refresh and preserves selection when possible", () => {
    const store = createDeviceFaultLogStore();

    store.replace(buildResult([
      { id: "fault-a", raw: "Reason: APP_CRASH\nSummary: first" },
      { id: "fault-b", raw: "Reason: APP_CRASH\nSummary: second" },
    ]));
    expect(store.getState().selectedEntryId).toBe("fault-a");

    store.selectEntry("fault-b");
    store.replace(buildResult([
      { id: "fault-b", raw: "Reason: APP_CRASH\nSummary: second again" },
      { id: "fault-c", raw: "Reason: APP_CRASH\nSummary: third" },
    ]));

    const state = store.getState();
    expect(state.selectedEntryId).toBe("fault-b");
    expect(state.entries.map((entry) => entry.id)).toEqual(["fault-b", "fault-c"]);
    expect(state.status).toBe("ready");
  });

  it("clearView clears in-memory view, resets metadata, and returns status to idle", () => {
    const store = createDeviceFaultLogStore();

    store.replace(buildResult([
      { id: "fault-a", raw: "Reason: APP_CRASH\nSummary: first" },
    ]));
    store.setFilter({
      ...emptyFilter,
      query: "first",
      process: "demo",
    });

    store.clearView();

    expect(store.getState()).toMatchObject({
      status: "idle",
      entries: [],
      selectedEntryId: null,
      deviceId: null,
      fetchedAt: null,
      command: "",
      stderr: "",
      message: "",
      filter: {
        query: "first",
        process: "demo",
      },
    });
  });
});
