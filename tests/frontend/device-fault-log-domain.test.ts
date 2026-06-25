import { describe, expect, it } from "vitest";
import { applyDeviceFaultLogFilter, compileDeviceFaultLogFilter } from "@/features/device-log/device-fault-log-filter";
import type { DeviceFaultLogFetchResult, DeviceFaultLogFilterState } from "@/features/device-log/device-fault-log-model";
import { parseDeviceFaultLogEntries } from "@/features/device-log/device-fault-log-parser";
import { createDeviceFaultLogStore } from "@/features/device-log/device-fault-log-store";

const emptyFilter: DeviceFaultLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  types: [],
  process: "",
  pid: "",
};

function buildResult(entries: Array<{ id: string; raw: string }>): DeviceFaultLogFetchResult {
  return {
    status: "success",
    error: null,
    entries,
  };
}

describe("device fault log parser", () => {
  it("classifies js crash and preserves stack lines", () => {
    const [entry] = parseDeviceFaultLogEntries(buildResult([
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

    expect(entry.type).toBe("JS_ERROR");
    expect(entry.process).toBe("com.example.demo");
    expect(entry.pid).toBe(4321);
    expect(entry.summary).toBe("Render crashed");
    expect(entry.error).toContain("TypeError");
    expect(entry.stacktrace).toEqual([
      "at render (pages/index.ets:12:3)",
      "at update (pages/app.ets:44:9)",
    ]);
    expect(entry.rawText).toContain("Stacktrace:");
  });

  it("keeps unknown entries inspectable", () => {
    const [entry] = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-2",
        raw: "opaque fault blob without structured fields",
      },
    ]));

    expect(entry.type).toBe("UNKNOWN");
    expect(entry.summary).toBe("opaque fault blob without structured fields");
    expect(entry.rawText).toBe("opaque fault blob without structured fields");
  });
});

describe("device fault log filter", () => {
  it("matches by type, process, pid, and plain text", () => {
    const [entry] = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-3",
        raw: [
          "Reason: App Freeze",
          "Process: com.example.camera",
          "PID: 987",
          "Summary: Main thread blocked by image decode",
        ].join("\n"),
      },
    ]));

    const compiled = compileDeviceFaultLogFilter({
      ...emptyFilter,
      query: "image decode",
      types: ["APP_FREEZE"],
      process: "camera",
      pid: "987",
    });

    expect(compiled.valid).toBe(true);
    expect(applyDeviceFaultLogFilter(entry, compiled)).toBe(true);
  });

  it("reports invalid regex and does not match", () => {
    const [entry] = parseDeviceFaultLogEntries(buildResult([
      {
        id: "fault-4",
        raw: "Summary: crash while starting",
      },
    ]));

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
      { id: "fault-a", raw: "Reason: App Crash\nSummary: first" },
      { id: "fault-b", raw: "Reason: App Crash\nSummary: second" },
    ]));
    expect(store.getState().selectedEntryId).toBe("fault-a");

    store.selectEntry("fault-b");
    store.replace(buildResult([
      { id: "fault-b", raw: "Reason: App Crash\nSummary: second again" },
      { id: "fault-c", raw: "Reason: App Crash\nSummary: third" },
    ]));

    const state = store.getState();
    expect(state.selectedEntryId).toBe("fault-b");
    expect(state.entries.map((entry) => entry.id)).toEqual(["fault-b", "fault-c"]);
    expect(state.status).toBe("success");
  });

  it("clearView clears only in-memory view and returns status to idle", () => {
    const store = createDeviceFaultLogStore();

    store.replace(buildResult([
      { id: "fault-a", raw: "Reason: App Crash\nSummary: first" },
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
      filter: {
        query: "first",
        process: "demo",
      },
    });
  });
});
