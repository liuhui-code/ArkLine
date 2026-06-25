# ArkLine Device Log Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DevEco-style Device Log bottom tool window that can discover HDC devices, start and stop streaming HiLog output, and filter logs with regex and structured fields.

**Architecture:** Build this as a separate Device Log domain instead of a Terminal mode. The frontend owns log parsing, ring-buffer storage, filtering, and UI state; the Tauri backend owns HDC discovery and long-running log stream processes. The first implementation must work without a physical device through deterministic mock data, while real-device support flows through the same `WorkspaceApi` surface.

**Tech Stack:** React, TypeScript, Vitest, Tauri v2 commands, Rust `std::process::Command`, existing ArkLine bottom tool window shell.

---

## File Structure

- Create `src/features/device-log/device-log-model.ts`
  - Defines device, stream, log entry, filter, and view model types.
- Create `src/features/device-log/device-log-parser.ts`
  - Parses common HiLog text lines into structured `DeviceLogEntry` values and keeps raw fallback lines.
- Create `src/features/device-log/device-log-filter.ts`
  - Compiles regex/text filters and evaluates entries by level, pid, package/process, domain, tag, and message.
- Create `src/features/device-log/device-log-store.ts`
  - Maintains bounded ring buffer, pause state, filter state, and derived visible entries.
- Create `src/components/layout/DeviceLogToolWindow.tsx`
  - Renders device selector, stream controls, filter bar, log list, and selected-line detail.
- Modify `src/features/workspace/workspace-api.ts`
  - Adds device log API methods and demo/mock implementations.
- Modify `src/components/layout/shell-state.ts`
  - Adds `deviceLog` to `BottomToolKey`.
- Modify `src/components/layout/BottomToolWindow.tsx`
  - Adds Device Log tab and panel slot.
- Modify `src/components/layout/AppShell.tsx`
  - Wires `DeviceLogToolWindow` into bottom tools and status text.
- Create `tests/frontend/device-log-domain.test.ts`
  - Tests parser, filter compiler, and ring-buffer behavior.
- Create `tests/frontend/device-log-tool-window.test.tsx`
  - Tests UI behavior using mock `WorkspaceApi`.
- Create `src-tauri/src/models/device_log.rs`
  - Defines serializable device log request/result/event models.
- Create `src-tauri/src/services/device_log_service.rs`
  - Locates `hdc`, lists devices, starts/stops streaming log processes, emits batches.
- Create `src-tauri/src/commands/device_log.rs`
  - Exposes Tauri commands for device log operations.
- Modify `src-tauri/src/lib.rs`
  - Registers device log models, commands, and runtime state.

---

### Task 1: Device Log Domain Model, Parser, Filter, Store

**Files:**
- Create: `src/features/device-log/device-log-model.ts`
- Create: `src/features/device-log/device-log-parser.ts`
- Create: `src/features/device-log/device-log-filter.ts`
- Create: `src/features/device-log/device-log-store.ts`
- Test: `tests/frontend/device-log-domain.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `tests/frontend/device-log-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyDeviceLogFilter, compileDeviceLogFilter } from "@/features/device-log/device-log-filter";
import { parseDeviceLogLine } from "@/features/device-log/device-log-parser";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
import type { DeviceLogFilterState } from "@/features/device-log/device-log-model";

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
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pnpm test -- tests/frontend/device-log-domain.test.ts
```

Expected: fail because the `device-log` modules do not exist.

- [ ] **Step 3: Implement device log types**

Create `src/features/device-log/device-log-model.ts`:

```ts
export type DeviceConnectionStatus = "unknown" | "online" | "offline" | "unauthorized";

export type DeviceLogLevel = "verbose" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

export type DeviceLogDevice = {
  id: string;
  label: string;
  status: DeviceConnectionStatus;
  detail: string;
};

export type DeviceLogStreamStatus = "idle" | "starting" | "running" | "paused" | "stopping" | "error";

export type DeviceLogEntry = {
  id: string;
  deviceId: string;
  raw: string;
  timestamp: string | null;
  level: DeviceLogLevel;
  pid: number | null;
  tid: number | null;
  process: string;
  domain: string;
  tag: string;
  message: string;
};

export type DeviceLogFilterState = {
  query: string;
  regex: boolean;
  matchCase: boolean;
  levels: DeviceLogLevel[];
  pid: string;
  process: string;
  domain: string;
  tag: string;
};

export type CompiledDeviceLogFilter = {
  valid: boolean;
  error: string | null;
  state: DeviceLogFilterState;
  queryPattern: RegExp | null;
};

export type DeviceLogState = {
  entries: DeviceLogEntry[];
  pendingEntries: DeviceLogEntry[];
  filter: DeviceLogFilterState;
  paused: boolean;
};
```

- [ ] **Step 4: Implement parser**

Create `src/features/device-log/device-log-parser.ts`:

```ts
import type { DeviceLogEntry, DeviceLogLevel } from "@/features/device-log/device-log-model";

const levelMap: Record<string, DeviceLogLevel> = {
  V: "verbose",
  D: "debug",
  I: "info",
  W: "warn",
  E: "error",
  F: "fatal",
};

const hilogPattern = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^/\s]+)\/([^\s]+)\s+([^:]+):\s?(.*)$/;

let nextEntryId = 0;

export function parseDeviceLogLine(raw: string, deviceId = "unknown"): DeviceLogEntry {
  const line = raw.replace(/\r?\n$/u, "");
  const match = hilogPattern.exec(line);
  const id = `log-${++nextEntryId}`;

  if (!match) {
    return {
      id,
      deviceId,
      raw: line,
      timestamp: null,
      level: "unknown",
      pid: null,
      tid: null,
      process: "",
      domain: "",
      tag: "",
      message: line,
    };
  }

  return {
    id,
    deviceId,
    raw: line,
    timestamp: match[1],
    pid: Number.parseInt(match[2], 10),
    tid: Number.parseInt(match[3], 10),
    level: levelMap[match[4]] ?? "unknown",
    domain: match[5],
    tag: match[6],
    process: match[7].trim(),
    message: match[8],
  };
}
```

- [ ] **Step 5: Implement filter compiler**

Create `src/features/device-log/device-log-filter.ts`:

```ts
import type { CompiledDeviceLogFilter, DeviceLogEntry, DeviceLogFilterState } from "@/features/device-log/device-log-model";

export function compileDeviceLogFilter(state: DeviceLogFilterState): CompiledDeviceLogFilter {
  const query = state.query.trim();
  if (!query) {
    return { valid: true, error: null, state, queryPattern: null };
  }

  try {
    const source = state.regex ? query : escapeRegExp(query);
    return {
      valid: true,
      error: null,
      state,
      queryPattern: new RegExp(source, state.matchCase ? "u" : "iu"),
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Invalid regular expression",
      state,
      queryPattern: null,
    };
  }
}

export function applyDeviceLogFilter(entry: DeviceLogEntry, compiled: CompiledDeviceLogFilter): boolean {
  if (!compiled.valid) {
    return false;
  }

  const { state } = compiled;
  if (compiled.queryPattern && !compiled.queryPattern.test(entry.message) && !compiled.queryPattern.test(entry.raw)) {
    return false;
  }

  if (state.levels.length > 0 && !state.levels.includes(entry.level)) {
    return false;
  }

  if (state.pid.trim() && String(entry.pid ?? "") !== state.pid.trim()) {
    return false;
  }

  return includesField(entry.process, state.process, state.matchCase)
    && includesField(entry.domain, state.domain, state.matchCase)
    && includesField(entry.tag, state.tag, state.matchCase);
}

function includesField(value: string, query: string, matchCase: boolean) {
  const trimmed = query.trim();
  if (!trimmed) {
    return true;
  }

  return matchCase
    ? value.includes(trimmed)
    : value.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase());
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
```

- [ ] **Step 6: Implement store**

Create `src/features/device-log/device-log-store.ts`:

```ts
import type { DeviceLogFilterState, DeviceLogState } from "@/features/device-log/device-log-model";
import { parseDeviceLogLine } from "@/features/device-log/device-log-parser";

const defaultFilter: DeviceLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  levels: [],
  pid: "",
  process: "",
  domain: "",
  tag: "",
};

export function createDeviceLogStore({ capacity = 20_000 }: { capacity?: number } = {}) {
  let state: DeviceLogState = {
    entries: [],
    pendingEntries: [],
    filter: defaultFilter,
    paused: false,
  };

  function trim<T>(items: T[]) {
    return items.length <= capacity ? items : items.slice(items.length - capacity);
  }

  return {
    getState() {
      return state;
    },
    appendRawLines(deviceId: string, lines: string[]) {
      const entries = lines.filter((line) => line.length > 0).map((line) => parseDeviceLogLine(line, deviceId));
      if (state.paused) {
        state = { ...state, pendingEntries: trim([...state.pendingEntries, ...entries]) };
        return;
      }
      state = { ...state, entries: trim([...state.entries, ...entries]) };
    },
    setPaused(paused: boolean) {
      if (state.paused === paused) {
        return;
      }

      if (!paused) {
        state = {
          ...state,
          paused,
          entries: trim([...state.entries, ...state.pendingEntries]),
          pendingEntries: [],
        };
        return;
      }

      state = { ...state, paused };
    },
    clear() {
      state = { ...state, entries: [], pendingEntries: [] };
    },
    setFilter(filter: DeviceLogFilterState) {
      state = { ...state, filter };
    },
  };
}
```

- [ ] **Step 7: Verify domain tests pass**

Run:

```bash
pnpm test -- tests/frontend/device-log-domain.test.ts
```

Expected: pass.

- [ ] **Step 8: Commit domain foundation**

Run:

```bash
git add src/features/device-log tests/frontend/device-log-domain.test.ts
git commit -m "feat: add device log domain foundation"
```

---

### Task 2: Workspace API Contract and Demo Device Log Backend

**Files:**
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/device-log-domain.test.ts`

- [ ] **Step 1: Add failing workspace API type usage test**

Append to `tests/frontend/device-log-domain.test.ts`:

```ts
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

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
```

- [ ] **Step 2: Run failing test**

Run:

```bash
pnpm test -- tests/frontend/device-log-domain.test.ts
```

Expected: fail because `WorkspaceApi` does not yet expose device log methods.

- [ ] **Step 3: Add API types and methods**

Modify `src/features/workspace/workspace-api.ts` near terminal types:

```ts
export type DeviceConnectionStatus = "unknown" | "online" | "offline" | "unauthorized";

export type DeviceLogDevice = {
  id: string;
  label: string;
  status: DeviceConnectionStatus;
  detail: string;
};

export type StartDeviceLogStreamRequest = {
  deviceId: string;
};

export type DeviceLogStreamSummary = {
  streamId: string;
  deviceId: string;
  status: "running";
};
```

Add to `WorkspaceApi`:

```ts
  listDeviceLogDevices(): Promise<DeviceLogDevice[]>;
  startDeviceLogStream(request: StartDeviceLogStreamRequest): Promise<DeviceLogStreamSummary>;
  stopDeviceLogStream(streamId: string): Promise<void>;
```

Add to `defaultWorkspaceApi`:

```ts
  async listDeviceLogDevices() {
    if (hasTauriRuntime()) {
      return invoke<DeviceLogDevice[]>("list_device_log_devices");
    }

    return [
      {
        id: "demo-device",
        label: "Demo HarmonyOS Device",
        status: "online",
        detail: "Mock HiLog stream",
      },
    ];
  },
  async startDeviceLogStream(request) {
    if (hasTauriRuntime()) {
      return invoke<DeviceLogStreamSummary>("start_device_log_stream", { request });
    }

    void request;
    return {
      streamId: "demo-device-log-stream",
      deviceId: "demo-device",
      status: "running",
    };
  },
  async stopDeviceLogStream(streamId) {
    if (hasTauriRuntime()) {
      await invoke("stop_device_log_stream", { streamId });
      return;
    }

    void streamId;
  },
```

- [ ] **Step 4: Verify API tests pass**

Run:

```bash
pnpm test -- tests/frontend/device-log-domain.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit API contract**

Run:

```bash
git add src/features/workspace/workspace-api.ts tests/frontend/device-log-domain.test.ts
git commit -m "feat: add device log workspace api"
```

---

### Task 3: Device Log Bottom Tool UI

**Files:**
- Create: `src/components/layout/DeviceLogToolWindow.tsx`
- Modify: `src/components/layout/shell-state.ts`
- Modify: `src/components/layout/BottomToolWindow.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Test: `tests/frontend/device-log-tool-window.test.tsx`
- Test: `tests/frontend/bottom-tool-window.test.tsx`

- [ ] **Step 1: Write failing UI tests**

Create `tests/frontend/device-log-tool-window.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

function createWorkspaceApi(): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    listDeviceLogDevices: async () => [
      {
        id: "device-1",
        label: "Pura 70 - USB",
        status: "online",
        detail: "USB",
      },
    ],
    startDeviceLogStream: async (request) => ({
      streamId: "stream-1",
      deviceId: request.deviceId,
      status: "running",
    }),
    stopDeviceLogStream: async () => undefined,
  };
}

describe("Device Log tool window", () => {
  it("opens from the bottom tool tabs and starts a stream for the selected device", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));

    const panel = await screen.findByLabelText("Device Log Panel");
    expect(panel).toBeVisible();
    expect(await within(panel).findByText("Pura 70 - USB")).toBeVisible();

    await user.click(within(panel).getByRole("button", { name: "Start Device Log Stream" }));
    expect(await within(panel).findByText("Running")).toBeVisible();
  });

  it("shows regex validation errors inline", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    await user.click(within(panel).getByRole("checkbox", { name: "Regex" }));
    fireEvent.change(within(panel).getByLabelText("Filter device logs"), { target: { value: "(" } });

    expect(await within(panel).findByText(/Invalid regular expression/u)).toBeVisible();
  });
});
```

Append to `tests/frontend/bottom-tool-window.test.tsx`:

```tsx
  it("includes Device Log as a bottom tool tab", () => {
    render(<AppShell />);

    expect(screen.getByRole("tab", { name: "Device Log" })).toBeVisible();
  });
```

- [ ] **Step 2: Run failing UI tests**

Run:

```bash
pnpm test -- tests/frontend/device-log-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx
```

Expected: fail because the Device Log tab and component do not exist.

- [ ] **Step 3: Add Device Log key to shell state**

Modify `src/components/layout/shell-state.ts`:

```ts
export type BottomToolKey = "problems" | "terminal" | "build" | "git" | "deviceLog";
```

- [ ] **Step 4: Add tab and panel slot**

Modify `src/components/layout/BottomToolWindow.tsx`:

```ts
  deviceLogPanel: ReactNode;
```

Update tab order and labels:

```ts
const tabOrder: BottomToolKey[] = ["problems", "terminal", "build", "git", "deviceLog"];

const tabLabels: Record<BottomToolKey, string> = {
  problems: "Problems",
  terminal: "Terminal",
  build: "Build",
  git: "Git",
  deviceLog: "Device Log",
};
```

Render the panel:

```tsx
        {activeTool === "deviceLog" ? (
          <div
            id="bottom-tool-panel-deviceLog"
            role="tabpanel"
            aria-labelledby="bottom-tool-tab-deviceLog"
          >
            {deviceLogPanel}
          </div>
        ) : null}
```

- [ ] **Step 5: Implement the Device Log UI component**

Create `src/components/layout/DeviceLogToolWindow.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { applyDeviceLogFilter, compileDeviceLogFilter } from "@/features/device-log/device-log-filter";
import type { DeviceLogFilterState, DeviceLogStreamStatus } from "@/features/device-log/device-log-model";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
import type { DeviceLogDevice, WorkspaceApi } from "@/features/workspace/workspace-api";

const initialFilter: DeviceLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  levels: [],
  pid: "",
  process: "",
  domain: "",
  tag: "",
};

type DeviceLogToolWindowProps = {
  active: boolean;
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

export function DeviceLogToolWindow({ active, workspaceApi, onStatusChange }: DeviceLogToolWindowProps) {
  const [devices, setDevices] = useState<DeviceLogDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<DeviceLogStreamStatus>("idle");
  const [filter, setFilter] = useState(initialFilter);
  const [storeVersion, setStoreVersion] = useState(0);
  const store = useMemo(() => createDeviceLogStore(), []);
  const compiledFilter = useMemo(() => compileDeviceLogFilter(filter), [filter]);
  const visibleEntries = store.getState().entries.filter((entry) => applyDeviceLogFilter(entry, compiledFilter));

  useEffect(() => {
    if (!active) {
      return;
    }

    let cancelled = false;
    void workspaceApi.listDeviceLogDevices().then((items) => {
      if (cancelled) {
        return;
      }
      setDevices(items);
      setSelectedDeviceId((current) => current || items[0]?.id || "");
    });

    return () => {
      cancelled = true;
    };
  }, [active, workspaceApi]);

  async function startStream() {
    if (!selectedDeviceId || streamStatus === "running" || streamStatus === "starting") {
      return;
    }

    setStreamStatus("starting");
    try {
      const stream = await workspaceApi.startDeviceLogStream({ deviceId: selectedDeviceId });
      setStreamId(stream.streamId);
      setStreamStatus("running");
      onStatusChange("Device log stream running");
    } catch (error) {
      setStreamStatus("error");
      onStatusChange(error instanceof Error ? error.message : "Device log stream failed");
    }
  }

  async function stopStream() {
    if (!streamId) {
      return;
    }

    setStreamStatus("stopping");
    await workspaceApi.stopDeviceLogStream(streamId);
    setStreamId(null);
    setStreamStatus("idle");
    onStatusChange("Device log stream stopped");
  }

  function updateFilter(patch: Partial<DeviceLogFilterState>) {
    const nextFilter = { ...filter, ...patch };
    setFilter(nextFilter);
    store.setFilter(nextFilter);
    setStoreVersion((value) => value + 1);
  }

  void storeVersion;

  return (
    <section className="device-log-tool-window" aria-label="Device Log Panel">
      <header className="device-log-tool-window__toolbar">
        <select
          aria-label="Device"
          value={selectedDeviceId}
          onChange={(event) => setSelectedDeviceId(event.target.value)}
        >
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.label}
            </option>
          ))}
        </select>
        <span className="device-log-tool-window__status">{streamStatus === "running" ? "Running" : streamStatus}</span>
        {streamStatus === "running" ? (
          <button type="button" onClick={() => void stopStream()} aria-label="Stop Device Log Stream">
            Stop
          </button>
        ) : (
          <button type="button" onClick={() => void startStream()} aria-label="Start Device Log Stream">
            Start
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            store.clear();
            setStoreVersion((value) => value + 1);
          }}
        >
          Clear
        </button>
      </header>
      <div className="device-log-tool-window__filters">
        <input
          aria-label="Filter device logs"
          value={filter.query}
          onChange={(event) => updateFilter({ query: event.target.value })}
          placeholder="Filter logs"
        />
        <label>
          <input
            type="checkbox"
            checked={filter.regex}
            onChange={(event) => updateFilter({ regex: event.target.checked })}
          />
          Regex
        </label>
        <label>
          <input
            type="checkbox"
            checked={filter.matchCase}
            onChange={(event) => updateFilter({ matchCase: event.target.checked })}
          />
          Match Case
        </label>
        {compiledFilter.error ? <span className="device-log-tool-window__filter-error">{compiledFilter.error}</span> : null}
      </div>
      <div className="device-log-tool-window__entries" role="log" aria-label="Device Log Entries">
        {visibleEntries.length === 0 ? (
          <p className="device-log-tool-window__empty">No log entries</p>
        ) : (
          visibleEntries.map((entry) => (
            <div key={entry.id} className={`device-log-tool-window__entry device-log-tool-window__entry--${entry.level}`}>
              <span>{entry.timestamp ?? "--"}</span>
              <span>{entry.level}</span>
              <span>{entry.tag || "-"}</span>
              <span>{entry.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Wire component into AppShell**

Modify imports in `src/components/layout/AppShell.tsx`:

```ts
import { DeviceLogToolWindow } from "@/components/layout/DeviceLogToolWindow";
```

Modify `BottomToolWindow` usage:

```tsx
        deviceLogPanel={<DeviceLogToolWindow active={bottomContentVisible && activeBottomTool === "deviceLog"} workspaceApi={workspaceApi} onStatusChange={setStatusText} />}
```

- [ ] **Step 7: Add minimal CSS**

Modify `src/styles/app.css` with focused, IDE-style rules:

```css
.device-log-tool-window {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  background: var(--color-panel, #1f2329);
  color: var(--color-text, #d7dce2);
}

.device-log-tool-window__toolbar,
.device-log-tool-window__filters {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 34px;
  padding: 4px 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.device-log-tool-window__filters input[aria-label="Filter device logs"] {
  min-width: 260px;
  max-width: 520px;
  flex: 1;
}

.device-log-tool-window__filter-error {
  color: #ff8f8f;
  font-size: 12px;
}

.device-log-tool-window__entries {
  min-height: 0;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
}

.device-log-tool-window__entry {
  display: grid;
  grid-template-columns: 130px 56px 140px minmax(0, 1fr);
  gap: 8px;
  padding: 2px 8px;
  white-space: pre-wrap;
}

.device-log-tool-window__entry--error,
.device-log-tool-window__entry--fatal {
  color: #ff8f8f;
}

.device-log-tool-window__entry--warn {
  color: #ffd37a;
}

.device-log-tool-window__empty {
  margin: 12px;
  color: var(--color-muted, #8b949e);
}
```

- [ ] **Step 8: Verify UI tests pass**

Run:

```bash
pnpm test -- tests/frontend/device-log-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx
```

Expected: pass.

- [ ] **Step 9: Commit UI shell**

Run:

```bash
git add src/components/layout src/styles/app.css tests/frontend/device-log-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx
git commit -m "feat: add device log tool window"
```

---

### Task 4: Tauri HDC Device Discovery

**Files:**
- Create: `src-tauri/src/models/device_log.rs`
- Create: `src-tauri/src/services/device_log_service.rs`
- Create: `src-tauri/src/commands/device_log.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: Rust unit tests inside `src-tauri/src/services/device_log_service.rs`

- [ ] **Step 1: Write failing Rust parsing tests**

Create `src-tauri/src/services/device_log_service.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hdc_targets_verbose_output() {
        let devices = parse_hdc_targets("127.0.0.1:5555\tConnected\nUSB123\tOffline\n");

        assert_eq!(devices.len(), 2);
        assert_eq!(devices[0].id, "127.0.0.1:5555");
        assert_eq!(devices[0].status, "online");
        assert_eq!(devices[1].status, "offline");
    }

    #[test]
    fn normalizes_failed_server_output_to_unknown_device_list() {
        let devices = parse_hdc_targets("Connect server failed\n");

        assert!(devices.is_empty());
    }
}
```

- [ ] **Step 2: Run failing Rust test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: fail because required types/functions are missing.

- [ ] **Step 3: Add Rust models**

Create `src-tauri/src/models/device_log.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogDevice {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartDeviceLogStreamRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogStreamSummary {
    pub stream_id: String,
    pub device_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLogOutputBatch {
    pub stream_id: String,
    pub device_id: String,
    pub lines: Vec<String>,
}
```

- [ ] **Step 4: Implement device discovery**

Replace `src-tauri/src/services/device_log_service.rs` content with:

```rust
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use crate::models::device_log::{DeviceLogDevice, DeviceLogStreamSummary, StartDeviceLogStreamRequest};

pub struct DeviceLogRuntime {
    streams: Mutex<HashMap<String, Arc<Mutex<Child>>>>,
    next_id: AtomicU64,
}

impl Default for DeviceLogRuntime {
    fn default() -> Self {
        Self {
            streams: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(0),
        }
    }
}

pub fn list_devices() -> Result<Vec<DeviceLogDevice>, String> {
    let output = Command::new(resolve_hdc_path())
        .args(["list", "targets", "-v"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to run hdc: {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");

    Ok(parse_hdc_targets(&combined))
}

pub fn parse_hdc_targets(output: &str) -> Vec<DeviceLogDevice> {
    output
        .lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.contains("Connect server failed") {
                return None;
            }

            let mut parts = trimmed.split_whitespace();
            let id = parts.next()?.to_string();
            let status_text = parts.next().unwrap_or("unknown");
            let status = match status_text.to_ascii_lowercase().as_str() {
                "connected" | "online" => "online",
                "offline" => "offline",
                "unauthorized" => "unauthorized",
                _ => "unknown",
            };

            Some(DeviceLogDevice {
                label: id.clone(),
                id,
                status: status.to_string(),
                detail: trimmed.to_string(),
            })
        })
        .collect()
}

pub fn start_stream(
    runtime: &DeviceLogRuntime,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    let stream_number = runtime.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let stream_id = format!("device-log-{stream_number}");
    let child = Command::new(resolve_hdc_path())
        .args(["-t", &request.device_id, "hilog"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Failed to start hdc hilog: {error}"))?;

    runtime
        .streams
        .lock()
        .expect("device log stream lock")
        .insert(stream_id.clone(), Arc::new(Mutex::new(child)));

    Ok(DeviceLogStreamSummary {
        stream_id,
        device_id: request.device_id,
        status: "running".to_string(),
    })
}

pub fn stop_stream(runtime: &DeviceLogRuntime, stream_id: &str) -> Result<(), String> {
    let child = runtime
        .streams
        .lock()
        .expect("device log stream lock")
        .remove(stream_id);

    if let Some(child) = child {
        child.lock().expect("device log child lock").kill().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn resolve_hdc_path() -> String {
    "hdc".to_string()
}
```

- [ ] **Step 5: Add Tauri commands**

Create `src-tauri/src/commands/device_log.rs`:

```rust
use tauri::State;

use crate::models::device_log::{DeviceLogDevice, DeviceLogStreamSummary, StartDeviceLogStreamRequest};
use crate::services::device_log_service::{list_devices, start_stream, stop_stream, DeviceLogRuntime};

#[tauri::command]
pub fn list_device_log_devices() -> Result<Vec<DeviceLogDevice>, String> {
    list_devices()
}

#[tauri::command]
pub fn start_device_log_stream(
    runtime: State<DeviceLogRuntime>,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    start_stream(runtime.inner(), request)
}

#[tauri::command]
pub fn stop_device_log_stream(runtime: State<DeviceLogRuntime>, stream_id: String) -> Result<(), String> {
    stop_stream(runtime.inner(), &stream_id)
}
```

- [ ] **Step 6: Register commands and runtime**

Modify `src-tauri/src/lib.rs`:

```rust
    pub mod device_log;
```

under both `commands` and `models`, and:

```rust
    pub mod device_log_service;
```

under `services`.

Add managed runtime:

```rust
        .manage(services::device_log_service::DeviceLogRuntime::default())
```

Add invoke handlers:

```rust
            commands::device_log::list_device_log_devices,
            commands::device_log::start_device_log_stream,
            commands::device_log::stop_device_log_stream,
```

- [ ] **Step 7: Verify Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: pass.

- [ ] **Step 8: Commit HDC discovery**

Run:

```bash
git add src-tauri/src
git commit -m "feat: add hdc device discovery"
```

---

### Task 5: Real Log Event Forwarding

**Files:**
- Modify: `src-tauri/src/services/device_log_service.rs`
- Modify: `src-tauri/src/commands/device_log.rs`
- Modify: `src/components/layout/DeviceLogToolWindow.tsx`
- Test: `tests/frontend/device-log-tool-window.test.tsx`

- [ ] **Step 1: Add frontend event handling test seam**

Append to `tests/frontend/device-log-tool-window.test.tsx`:

```tsx
  it("renders appended raw log lines through the same parser and filter path", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    const panel = await screen.findByLabelText("Device Log Panel");

    fireEvent(
      panel,
      new CustomEvent("arkline-device-log-lines", {
        bubbles: true,
        detail: {
          deviceId: "device-1",
          lines: ["06-25 15:21:48.123  1234  5678 I C03F00/AppTag com.example.demo: rendered line"],
        },
      }),
    );

    expect(await within(panel).findByText("rendered line")).toBeVisible();
  });
```

- [ ] **Step 2: Run failing frontend test**

Run:

```bash
pnpm test -- tests/frontend/device-log-tool-window.test.tsx
```

Expected: fail because the component does not handle log line events yet.

- [ ] **Step 3: Add frontend listener for Tauri and test events**

Modify `src/components/layout/DeviceLogToolWindow.tsx`:

```tsx
import { listen } from "@tauri-apps/api/event";
```

Add effect:

```tsx
  useEffect(() => {
    function appendLines(deviceId: string, lines: string[]) {
      store.appendRawLines(deviceId, lines);
      setStoreVersion((value) => value + 1);
    }

    function handleTestEvent(event: Event) {
      const detail = (event as CustomEvent<{ deviceId: string; lines: string[] }>).detail;
      appendLines(detail.deviceId, detail.lines);
    }

    const panelEventTarget = document;
    panelEventTarget.addEventListener("arkline-device-log-lines", handleTestEvent);

    let disposed = false;
    let teardown: () => void = () => {};
    if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
      void listen<{ streamId: string; deviceId: string; lines: string[] }>("device-log-output", (event) => {
        appendLines(event.payload.deviceId, event.payload.lines);
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        teardown = unlisten;
      });
    }

    return () => {
      disposed = true;
      teardown();
      panelEventTarget.removeEventListener("arkline-device-log-lines", handleTestEvent);
    };
  }, [store]);
```

- [ ] **Step 4: Forward backend stdout batches**

Modify `src-tauri/src/services/device_log_service.rs`:

```rust
use std::io::{BufRead, BufReader};
use std::thread;
use crate::models::device_log::DeviceLogOutputBatch;
use tauri::{AppHandle, Emitter};
```

Change `start_stream` signature:

```rust
pub fn start_stream(
    app: AppHandle,
    runtime: &DeviceLogRuntime,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
```

After spawning the child and before inserting:

```rust
    let stdout = child.stdout.take().ok_or_else(|| "Failed to capture hdc hilog stdout".to_string())?;
    let stream_id_for_thread = stream_id.clone();
    let device_id_for_thread = request.device_id.clone();
    let app_for_thread = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        let mut batch: Vec<String> = Vec::new();
        for line in reader.lines().map_while(Result::ok) {
            batch.push(line);
            if batch.len() >= 50 {
                let _ = app_for_thread.emit(
                    "device-log-output",
                    DeviceLogOutputBatch {
                        stream_id: stream_id_for_thread.clone(),
                        device_id: device_id_for_thread.clone(),
                        lines: std::mem::take(&mut batch),
                    },
                );
            }
        }
        if !batch.is_empty() {
            let _ = app_for_thread.emit(
                "device-log-output",
                DeviceLogOutputBatch {
                    stream_id: stream_id_for_thread,
                    device_id: device_id_for_thread,
                    lines: batch,
                },
            );
        }
    });
```

Update `src-tauri/src/commands/device_log.rs`:

```rust
use tauri::{AppHandle, State};
```

and:

```rust
pub fn start_device_log_stream(
    app: AppHandle,
    runtime: State<DeviceLogRuntime>,
    request: StartDeviceLogStreamRequest,
) -> Result<DeviceLogStreamSummary, String> {
    start_stream(app, runtime.inner(), request)
}
```

- [ ] **Step 5: Verify frontend and Rust build**

Run:

```bash
pnpm test -- tests/frontend/device-log-tool-window.test.tsx
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: both pass.

- [ ] **Step 6: Commit log forwarding**

Run:

```bash
git add src-tauri/src src/components/layout/DeviceLogToolWindow.tsx tests/frontend/device-log-tool-window.test.tsx
git commit -m "feat: stream hdc hilog output"
```

---

### Task 6: Final Verification and Integration Polish

**Files:**
- Modify only files touched above if tests reveal integration issues.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm test -- tests/frontend/device-log-domain.test.ts tests/frontend/device-log-tool-window.test.tsx tests/frontend/bottom-tool-window.test.tsx
```

Expected: pass.

- [ ] **Step 2: Run Rust focused tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: pass.

- [ ] **Step 3: Run full test suite**

Run:

```bash
pnpm test
```

Expected: pass.

- [ ] **Step 4: Run production build**

Run:

```bash
pnpm build
```

Expected: pass.

- [ ] **Step 5: Manual smoke check with no connected device**

Run the app:

```bash
pnpm dev
```

Open the app, click `Device Log`, and verify:

- The Device Log tab is visible.
- If no real HDC server/device is available, the UI reports an empty/failed device list without freezing.
- Regex `(` shows an inline validation error.
- The bottom tool window can still resize, close, and reopen.

- [ ] **Step 6: Manual smoke check with a connected engineering device**

With a HarmonyOS engineering device connected and authorized:

```bash
hdc list targets -v
```

Expected: at least one online target.

Then in ArkLine:

- Select the target.
- Click `Start`.
- Confirm streaming log rows appear.
- Enter a text filter that matches a known tag or message.
- Toggle `Regex` and filter with a valid expression.
- Click `Stop`.

- [ ] **Step 7: Commit final polish if needed**

If fixes were needed:

```bash
git add <changed-files>
git commit -m "fix: polish device log integration"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: Covers HDC discovery, stream lifecycle, structured HiLog parsing, regex/text filtering, bottom tool UI, no-device behavior, and real-device manual smoke.
- Placeholder scan: No `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: `DeviceLogDevice`, `StartDeviceLogStreamRequest`, `DeviceLogStreamSummary`, `DeviceLogEntry`, and filter types are consistently named across tasks.
- Scope control: FaultLog, AppKilled, bugreport, screen capture/recording, offline `hilogtool parse`, and saved custom filter presets are explicitly out of first implementation scope.
