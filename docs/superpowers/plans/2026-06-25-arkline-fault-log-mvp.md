# ArkLine Fault Log MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a DevEco-style Fault Log subview inside the existing Device Log workbench so ArkLine can fetch, parse, filter, inspect, and copy HarmonyOS fault entries from a connected device.

**Architecture:** Reuse the existing Device Log foundation instead of creating another bottom tool. The frontend owns fault-log parsing, filter state, selection, and inspector layout; the Tauri backend owns HDC command execution and normalization of command failures into explicit statuses. The workbench stays split into `HiLog` and `Fault Log`, with clear room to evolve later without mixing live-stream and crash-diagnostics state.

**Tech Stack:** React, TypeScript, Vitest, Tauri v2 commands, Rust `std::process::Command`, existing ArkLine bottom tool window shell.

---

## File Structure

- Create `src/features/device-log/device-fault-log-model.ts`
  - Defines raw fetch result, parsed entry, filter state, and view state for Fault Log.
- Create `src/features/device-log/device-fault-log-parser.ts`
  - Splits raw backend payloads into entry blocks and classifies common HarmonyOS crash formats while preserving raw fallback text.
- Create `src/features/device-log/device-fault-log-filter.ts`
  - Compiles text/regex/type/pid/process filters and applies them to parsed entries.
- Create `src/features/device-log/device-fault-log-store.ts`
  - Owns Fault Log fetch state, selected entry, derived visible entries, and clear-view behavior.
- Create `src/components/layout/DeviceFaultLogPanel.tsx`
  - Renders Fault Log toolbar, state banners, result list, inspector, and copy actions.
- Create `src/components/layout/DeviceHiLogPanel.tsx`
  - Extracts the current live-log controls and list from `DeviceLogToolWindow.tsx` so the shell can host both tabs cleanly.
- Modify `src/components/layout/DeviceLogToolWindow.tsx`
  - Becomes the shared workbench shell with device selector, device status, internal tabs, and per-tab content.
- Modify `src/features/workspace/workspace-api.ts`
  - Adds Fault Log request/result types and demo/mock implementations alongside the current Device Log API.
- Create `tests/frontend/device-fault-log-domain.test.ts`
  - Tests parser, filter compiler, and store selection preservation.
- Create `tests/frontend/device-fault-log-tool-window.test.tsx`
  - Tests the workbench tabs, fetch states, filtering, inspector behavior, and copy actions using a mock `WorkspaceApi`.
- Modify `tests/frontend/device-log-tool-window.test.tsx`
  - Keeps the existing HiLog test path valid after the workbench split.
- Modify `src-tauri/src/models/device_log.rs`
  - Adds serializable fault-log request/result types next to the existing device-log types.
- Modify `src-tauri/src/services/device_log_service.rs`
  - Adds a fault-log fetch path, command-status normalization, and parser helpers for raw entry blocks.
- Modify `src-tauri/src/commands/device_log.rs`
  - Exposes `list_device_fault_logs`.
- Modify `src-tauri/src/lib.rs`
  - Registers the new Tauri command.

---

### Task 1: Fault Log Domain Types, Parser, Filter, Store

**Files:**
- Create: `src/features/device-log/device-fault-log-model.ts`
- Create: `src/features/device-log/device-fault-log-parser.ts`
- Create: `src/features/device-log/device-fault-log-filter.ts`
- Create: `src/features/device-log/device-fault-log-store.ts`
- Test: `tests/frontend/device-fault-log-domain.test.ts`

- [ ] **Step 1: Write the failing domain test**

Create `tests/frontend/device-fault-log-domain.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { applyDeviceFaultLogFilter, compileDeviceFaultLogFilter } from "@/features/device-log/device-fault-log-filter";
import { parseDeviceFaultLogEntries } from "@/features/device-log/device-fault-log-parser";
import { createDeviceFaultLogStore } from "@/features/device-log/device-fault-log-store";
import type { DeviceFaultLogFilterState, DeviceFaultLogFetchResult } from "@/features/device-log/device-fault-log-model";

const emptyFilter: DeviceFaultLogFilterState = {
  type: "all",
  query: "",
  regex: false,
  matchCase: false,
  process: "",
  pid: "",
};

function createFetchResult(rawEntries: string[]): DeviceFaultLogFetchResult {
  return {
    deviceId: "device-1",
    fetchedAt: "2026-06-25T10:00:00.000Z",
    entries: rawEntries.map((raw, index) => ({ id: `raw-${index + 1}`, raw })),
    command: "hdc faultlog",
    stderr: "",
    status: "ok",
    message: "",
  };
}

describe("device fault log parser", () => {
  it("classifies js crash and preserves stack lines", () => {
    const result = parseDeviceFaultLogEntries(
      createFetchResult([
        "Reason: JS_ERROR\nProcess: com.example.demo\nPID: 4321\nBundleName: com.example.demo\nError: width is not defined\nStacktrace:\n  at pages/Index.ets:18:7",
      ]),
    );

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].type).toBe("jsCrash");
    expect(result.entries[0].bundleName).toBe("com.example.demo");
    expect(result.entries[0].pid).toBe(4321);
    expect(result.entries[0].stack[0]).toContain("pages/Index.ets");
  });

  it("keeps unknown entries inspectable", () => {
    const result = parseDeviceFaultLogEntries(createFetchResult(["raw unknown fault payload"]));

    expect(result.entries[0].type).toBe("unknown");
    expect(result.entries[0].summary).toContain("raw unknown fault payload");
    expect(result.entries[0].raw).toBe("raw unknown fault payload");
  });
});

describe("device fault log filter", () => {
  it("matches by type, process, pid, and plain text", () => {
    const { entries } = parseDeviceFaultLogEntries(
      createFetchResult(["Reason: APP_CRASH\nProcess: com.example.demo\nPID: 1234\nSummary: render width failed"]),
    );
    const compiled = compileDeviceFaultLogFilter({
      ...emptyFilter,
      type: "cppCrash",
      process: "demo",
      pid: "1234",
      query: "width",
    });

    expect(compiled.valid).toBe(true);
    expect(applyDeviceFaultLogFilter(entries[0], compiled)).toBe(true);
  });

  it("reports invalid regex without matching", () => {
    const { entries } = parseDeviceFaultLogEntries(createFetchResult(["Reason: APP_FREEZE\nProcess: demo"]));
    const compiled = compileDeviceFaultLogFilter({ ...emptyFilter, query: "(", regex: true });

    expect(compiled.valid).toBe(false);
    expect(compiled.error).toContain("Invalid regular expression");
    expect(applyDeviceFaultLogFilter(entries[0], compiled)).toBe(false);
  });
});

describe("device fault log store", () => {
  it("selects the first entry after refresh and preserves selection when possible", () => {
    const store = createDeviceFaultLogStore();
    const first = parseDeviceFaultLogEntries(createFetchResult(["Reason: JS_ERROR\nProcess: app.one"]));
    const second = parseDeviceFaultLogEntries(
      createFetchResult([
        "Reason: JS_ERROR\nProcess: app.one",
        "Reason: APP_FREEZE\nProcess: app.two",
      ]),
    );

    store.replace(first);
    const selectedId = store.getState().selectedEntryId;
    store.replace(second);

    expect(store.getState().selectedEntryId).toBe(selectedId);
    expect(store.getState().entries).toHaveLength(2);
  });

  it("clears only the in-memory view", () => {
    const store = createDeviceFaultLogStore();
    store.replace(parseDeviceFaultLogEntries(createFetchResult(["Reason: JS_ERROR\nProcess: app.one"])));

    store.clearView();

    expect(store.getState().entries).toEqual([]);
    expect(store.getState().status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test -- tests/frontend/device-fault-log-domain.test.ts
```

Expected: FAIL because the `device-fault-log` modules do not exist yet.

- [ ] **Step 3: Write the minimal frontend domain implementation**

Create the four `src/features/device-log/device-fault-log-*.ts` files with these exported surfaces:

```ts
export type DeviceFaultLogFetchStatus = "idle" | "loading" | "ready" | "empty" | "unavailable" | "unauthorized" | "error";
export type DeviceFaultLogType = "jsCrash" | "cppCrash" | "appFreeze" | "appKilled" | "sysWarning" | "unknown";
export type DeviceFaultLogSeverity = "fatal" | "error" | "warning" | "unknown";

export type DeviceFaultLogRawEntry = {
  id: string;
  raw: string;
};

export type DeviceFaultLogFetchResult = {
  deviceId: string;
  fetchedAt: string;
  entries: DeviceFaultLogRawEntry[];
  command: string;
  stderr: string;
  status: Exclude<DeviceFaultLogFetchStatus, "idle" | "loading" | "ready"> | "ok";
  message: string;
};

export type DeviceFaultLogEntry = {
  id: string;
  rawId: string;
  deviceId: string;
  type: DeviceFaultLogType;
  severity: DeviceFaultLogSeverity;
  timestamp: string | null;
  bundleName: string;
  processName: string;
  pid: number | null;
  reason: string;
  summary: string;
  stack: string[];
  raw: string;
};

export type DeviceFaultLogFilterState = {
  type: "all" | DeviceFaultLogType;
  query: string;
  regex: boolean;
  matchCase: boolean;
  process: string;
  pid: string;
};

export function parseDeviceFaultLogEntries(result: DeviceFaultLogFetchResult): {
  deviceId: string;
  fetchedAt: string;
  status: DeviceFaultLogFetchStatus;
  command: string;
  stderr: string;
  message: string;
  entries: DeviceFaultLogEntry[];
} { /* classify by Reason / Process / PID / BundleName fields, keep unknown raw */ }

export function compileDeviceFaultLogFilter(state: DeviceFaultLogFilterState): {
  valid: boolean;
  error: string | null;
  state: DeviceFaultLogFilterState;
  queryPattern: RegExp | null;
} { /* same regex strategy as device-log-filter */ }

export function applyDeviceFaultLogFilter(entry: DeviceFaultLogEntry, compiled: ReturnType<typeof compileDeviceFaultLogFilter>) {
  /* match type, process, pid, summary/raw text */
}

export function createDeviceFaultLogStore() {
  /* replace(result), setFilter(filter), selectEntry(id), clearView(), getState() */
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
pnpm test -- tests/frontend/device-fault-log-domain.test.ts
```

Expected: PASS with parser, filter, and store coverage green.

- [ ] **Step 5: Commit the domain slice**

```bash
git add tests/frontend/device-fault-log-domain.test.ts src/features/device-log/device-fault-log-model.ts src/features/device-log/device-fault-log-parser.ts src/features/device-log/device-fault-log-filter.ts src/features/device-log/device-fault-log-store.ts
git commit -m "feat: add fault log domain foundation"
```

---

### Task 2: Workspace API Contract And Demo Fault Log Data

**Files:**
- Modify: `src/features/workspace/workspace-api.ts`
- Test: `tests/frontend/device-fault-log-domain.test.ts`

- [ ] **Step 1: Extend the failing workspace API test**

Append this test to `tests/frontend/device-fault-log-domain.test.ts`:

```ts
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";

describe("device fault log workspace api demo implementation", () => {
  it("returns deterministic demo fault entries outside tauri", async () => {
    const result = await defaultWorkspaceApi.listDeviceFaultLogs({ deviceId: "demo-device" });

    expect(result.deviceId).toBe("demo-device");
    expect(result.status).toBe("ok");
    expect(result.entries[0].raw).toContain("JS_ERROR");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm test -- tests/frontend/device-fault-log-domain.test.ts
```

Expected: FAIL because `listDeviceFaultLogs` is missing from `WorkspaceApi`.

- [ ] **Step 3: Add the API contract and demo implementation**

Modify `src/features/workspace/workspace-api.ts` to add:

```ts
export type ListDeviceFaultLogsRequest = {
  deviceId: string;
};

export type WorkspaceApi = {
  // existing members
  listDeviceFaultLogs(request: ListDeviceFaultLogsRequest): Promise<DeviceFaultLogFetchResult>;
};
```

Add the default implementation near the existing Device Log methods:

```ts
  async listDeviceFaultLogs(request) {
    if (hasTauriRuntime()) {
      return invoke<DeviceFaultLogFetchResult>("list_device_fault_logs", { request });
    }

    return {
      deviceId: request.deviceId,
      fetchedAt: "2026-06-25T10:00:00.000Z",
      entries: [
        {
          id: "raw-1",
          raw: "Timestamp: 2026-06-25 10:00:00\nReason: JS_ERROR\nProcess: com.example.demo\nPID: 4321\nBundleName: com.example.demo\nSummary: width is not defined\nStacktrace:\n  at pages/Index.ets:18:7",
        },
      ],
      command: "demo fault log",
      stderr: "",
      status: "ok",
      message: "",
    };
  },
```

- [ ] **Step 4: Run the updated test**

Run:

```bash
pnpm test -- tests/frontend/device-fault-log-domain.test.ts
```

Expected: PASS with demo data flowing through the same parser-facing shape as Tauri.

- [ ] **Step 5: Commit the API slice**

```bash
git add src/features/workspace/workspace-api.ts tests/frontend/device-fault-log-domain.test.ts
git commit -m "feat: add fault log workspace api"
```

---

### Task 3: Device Log Workbench Shell And Fault Log UI

**Files:**
- Create: `src/components/layout/DeviceHiLogPanel.tsx`
- Create: `src/components/layout/DeviceFaultLogPanel.tsx`
- Modify: `src/components/layout/DeviceLogToolWindow.tsx`
- Modify: `tests/frontend/device-log-tool-window.test.tsx`
- Create: `tests/frontend/device-fault-log-tool-window.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

Create `tests/frontend/device-fault-log-tool-window.test.tsx`:

```ts
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi, type WorkspaceApi } from "@/features/workspace/workspace-api";

function createWorkspaceApi(): WorkspaceApi {
  return {
    ...defaultWorkspaceApi,
    listDeviceLogDevices: async () => [{ id: "device-1", label: "Pura 70 - USB", status: "online", detail: "USB" }],
    listDeviceFaultLogs: async () => ({
      deviceId: "device-1",
      fetchedAt: "2026-06-25T10:00:00.000Z",
      entries: [
        {
          id: "raw-1",
          raw: "Reason: JS_ERROR\nProcess: com.example.demo\nPID: 4321\nBundleName: com.example.demo\nSummary: width is not defined\nStacktrace:\n  at pages/Index.ets:18:7",
        },
      ],
      command: "hdc faultlog",
      stderr: "",
      status: "ok",
      message: "",
    }),
    startDeviceLogStream: async (request) => ({ streamId: "stream-1", deviceId: request.deviceId, status: "running" }),
    stopDeviceLogStream: async () => undefined,
  };
}

describe("Device Fault Log tool window", () => {
  it("opens the fault log tab, refreshes entries, and shows the inspector", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.click(screen.getByRole("tab", { name: "Device Log" }));
    const panel = await screen.findByLabelText("Device Log Panel");
    await user.click(within(panel).getByRole("tab", { name: "Fault Log" }));
    await user.click(within(panel).getByRole("button", { name: "Refresh Fault Logs" }));

    expect(await within(panel).findByText("width is not defined")).toBeVisible();
    expect(within(panel).getByText("com.example.demo")).toBeVisible();
  });
});
```

Update `tests/frontend/device-log-tool-window.test.tsx` so the current HiLog test still clicks the inner `HiLog` tab before asserting `Start Device Log Stream`.

- [ ] **Step 2: Run the UI tests to verify they fail**

Run:

```bash
pnpm test -- tests/frontend/device-log-tool-window.test.tsx tests/frontend/device-fault-log-tool-window.test.tsx
```

Expected: FAIL because the workbench tabs and Fault Log UI do not exist yet.

- [ ] **Step 3: Split the workbench UI**

Create `src/components/layout/DeviceHiLogPanel.tsx` by moving the current start/stop/clear/filter/log-list UI out of `DeviceLogToolWindow.tsx`.

Create `src/components/layout/DeviceFaultLogPanel.tsx` with this public shape:

```tsx
type DeviceFaultLogPanelProps = {
  active: boolean;
  deviceId: string;
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

export function DeviceFaultLogPanel(props: DeviceFaultLogPanelProps) {
  // owns refresh flow, local filter form, compiled filter, copy summary/raw actions, and inspector rendering
}
```

Modify `src/components/layout/DeviceLogToolWindow.tsx` so it becomes the shell:

```tsx
const tabs = [
  { key: "hilog", label: "HiLog" },
  { key: "faultLog", label: "Fault Log" },
] as const;

export function DeviceLogToolWindow({ active, workspaceApi, onStatusChange }: DeviceLogToolWindowProps) {
  // shared device selector and device status
  // internal tablist
  // render <DeviceHiLogPanel ... /> or <DeviceFaultLogPanel ... />
}
```

The Fault Log panel must implement:

```tsx
// toolbar buttons
<button type="button" aria-label="Refresh Fault Logs">Refresh</button>
<button type="button" aria-label="Copy Fault Summary">Copy summary</button>
<button type="button" aria-label="Copy Fault Raw">Copy raw</button>
<button type="button" aria-label="Clear Fault Log View">Clear</button>

// filters
// type segmented buttons: All / JS / C++ / Freeze / Killed / Unknown
// query input + regex + match-case
// process input
// pid input

// states
// idle / loading / empty / unavailable / unauthorized / error banners
// list on the left, inspector on the right or stacked in narrow mode
```

- [ ] **Step 4: Run the UI tests to verify they pass**

Run:

```bash
pnpm test -- tests/frontend/device-log-tool-window.test.tsx tests/frontend/device-fault-log-tool-window.test.tsx
```

Expected: PASS with both the legacy HiLog flow and the new Fault Log flow covered.

- [ ] **Step 5: Commit the UI slice**

```bash
git add src/components/layout/DeviceHiLogPanel.tsx src/components/layout/DeviceFaultLogPanel.tsx src/components/layout/DeviceLogToolWindow.tsx tests/frontend/device-log-tool-window.test.tsx tests/frontend/device-fault-log-tool-window.test.tsx
git commit -m "feat: add fault log workbench ui"
```

---

### Task 4: Tauri Fault Log Command And Status Normalization

**Files:**
- Modify: `src-tauri/src/models/device_log.rs`
- Modify: `src-tauri/src/services/device_log_service.rs`
- Modify: `src-tauri/src/commands/device_log.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing Rust tests**

Add these tests to `src-tauri/src/services/device_log_service.rs`:

```rust
#[test]
fn parses_fault_log_status_from_connect_server_failure() {
    let result = normalize_fault_log_output(
        "device-1",
        "hdc faultlog".to_string(),
        "",
        "Connect server failed",
    );

    assert_eq!(result.status, "unavailable");
    assert!(result.message.contains("Connect server failed"));
}

#[test]
fn parses_fault_log_payload_into_raw_blocks() {
    let result = normalize_fault_log_output(
        "device-1",
        "hdc shell".to_string(),
        "Reason: JS_ERROR\nProcess: app.one\n\nReason: APP_FREEZE\nProcess: app.two",
        "",
    );

    assert_eq!(result.status, "ok");
    assert_eq!(result.entries.len(), 2);
    assert!(result.entries[0].raw.contains("JS_ERROR"));
}
```

- [ ] **Step 2: Run the Rust test to verify it fails**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: FAIL because the fault-log result types and normalization helpers do not exist yet.

- [ ] **Step 3: Implement Tauri fault-log models, service, and command**

Modify `src-tauri/src/models/device_log.rs` to add:

```rust
#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListDeviceFaultLogsRequest {
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFaultLogRawEntry {
    pub id: String,
    pub raw: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceFaultLogFetchResult {
    pub device_id: String,
    pub fetched_at: String,
    pub entries: Vec<DeviceFaultLogRawEntry>,
    pub command: String,
    pub stderr: String,
    pub status: String,
    pub message: String,
}
```

Modify `src-tauri/src/services/device_log_service.rs` to add:

```rust
pub fn list_fault_logs(request: ListDeviceFaultLogsRequest) -> Result<DeviceFaultLogFetchResult, String> {
    let command = format!("{} -t {} shell faultloggerd --dump", resolve_hdc_path(), request.device_id);
    let output = Command::new(resolve_hdc_path())
        .args(["-t", &request.device_id, "shell", "faultloggerd", "--dump"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| format!("Failed to fetch fault logs: {error}"))?;

    Ok(normalize_fault_log_output(
        &request.device_id,
        command,
        &String::from_utf8_lossy(&output.stdout),
        &String::from_utf8_lossy(&output.stderr),
    ))
}

fn normalize_fault_log_output(
    device_id: &str,
    command: String,
    stdout: &str,
    stderr: &str,
) -> DeviceFaultLogFetchResult {
    // map connect-server failure -> unavailable
    // map unauthorized -> unauthorized
    // map empty payload -> empty
    // otherwise split blocks on blank lines and emit raw entries
}
```

Modify `src-tauri/src/commands/device_log.rs` to add:

```rust
#[tauri::command]
pub fn list_device_fault_logs(request: ListDeviceFaultLogsRequest) -> Result<DeviceFaultLogFetchResult, String> {
    list_fault_logs(request)
}
```

Modify `src-tauri/src/lib.rs` to register `commands::device_log::list_device_fault_logs`.

- [ ] **Step 4: Run the Rust tests to verify they pass**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: PASS with raw fault-log blocks and failure mapping covered.

- [ ] **Step 5: Commit the backend slice**

```bash
git add src-tauri/src/models/device_log.rs src-tauri/src/services/device_log_service.rs src-tauri/src/commands/device_log.rs src-tauri/src/lib.rs
git commit -m "feat: add fault log tauri command"
```

---

### Task 5: Full Verification And Final Wiring

**Files:**
- Modify: `src/components/layout/DeviceFaultLogPanel.tsx`
- Modify: `src/features/workspace/workspace-api.ts`
- Modify: `src-tauri/src/services/device_log_service.rs`
- Test: `tests/frontend/device-fault-log-domain.test.ts`
- Test: `tests/frontend/device-fault-log-tool-window.test.tsx`

- [ ] **Step 1: Run the focused frontend suite**

Run:

```bash
pnpm test -- tests/frontend/device-fault-log-domain.test.ts tests/frontend/device-fault-log-tool-window.test.tsx tests/frontend/device-log-tool-window.test.tsx
```

Expected: PASS with no regressions in the current HiLog UI path.

- [ ] **Step 2: Run the backend suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

Expected: PASS.

- [ ] **Step 3: Run the broader project verification**

Run:

```bash
pnpm test
pnpm build
```

Expected: PASS for the full frontend test suite and build.

- [ ] **Step 4: Make any final fixes revealed by verification and rerun the affected command**

Use the smallest fix necessary. If a failure is in the UI suite, rerun:

```bash
pnpm test -- tests/frontend/device-fault-log-domain.test.ts tests/frontend/device-fault-log-tool-window.test.tsx tests/frontend/device-log-tool-window.test.tsx
```

If a failure is in the Rust suite, rerun:

```bash
cargo test --manifest-path src-tauri/Cargo.toml device_log_service
```

- [ ] **Step 5: Commit the verified final integration**

```bash
git add src/components/layout/DeviceFaultLogPanel.tsx src/features/workspace/workspace-api.ts src-tauri/src/services/device_log_service.rs tests/frontend/device-fault-log-domain.test.ts tests/frontend/device-fault-log-tool-window.test.tsx tests/frontend/device-log-tool-window.test.tsx
git commit -m "feat: finalize fault log mvp"
```

---

## Self-Review

- Spec coverage check:
  - Refresh, parse, list, inspector, filters, copy actions, and clear-view are covered in Tasks 1-3.
  - `idle` / `loading` / `ready` / `empty` / `unavailable` / `unauthorized` / `error` states are covered in Tasks 1, 3, and 4.
  - Conservative backend command execution and structured failure mapping are covered in Task 4.
  - Focused and broad verification are covered in Task 5.
- Placeholder scan:
  - No placeholder markers or delayed-implementation notes remain in task steps.
  - The one intentionally open point is the exact HarmonyOS command path; the plan constrains that uncertainty to `list_fault_logs()` instead of leaking it through the UI.
- Type consistency:
  - Frontend API and backend models both use `listDeviceFaultLogs` / `list_device_fault_logs`.
  - The fetch result shape stays aligned around `deviceId`, `fetchedAt`, `entries`, `command`, `stderr`, `status`, and `message`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-25-arkline-fault-log-mvp.md`. Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration
2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
