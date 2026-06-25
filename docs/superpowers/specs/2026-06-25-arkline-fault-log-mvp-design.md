# ArkLine Fault Log MVP Design

## Goal

Add a DevEco-style Fault Log view inside the existing Device Log workbench so developers can quickly discover, inspect, filter, and copy crash or app-killed diagnostics from a connected HarmonyOS device.

This stage prioritizes fault diagnosis over additional HiLog polish. The user-facing target is simple: when an app crashes, is killed, or produces a serious runtime fault, ArkLine should surface the relevant fault entry faster than searching raw live logs.

## Current Baseline

ArkLine already has:

- A `Device Log` bottom tool tab.
- HDC-backed device discovery through `list_device_log_devices`.
- HDC-backed live `hilog` streaming through `start_device_log_stream`.
- Frontend parser/filter/store modules under `src/features/device-log`.
- A basic Device Log UI in `src/components/layout/DeviceLogToolWindow.tsx`.

DevEco Studio also separates HDC/device management from log-specific UI. Its plugin structure includes distinct HiLog, FaultLog, AppKilled, device monitor, and HDC support classes. ArkLine should follow that shape at a smaller scale: shared device runtime, separate diagnostic views.

## Product Shape

Fault Log should live inside the `Device Log` bottom tool window as a sub-view, not as another top-level bottom tab.

The workbench gets two internal tabs:

- `HiLog`: the current live stream view.
- `Fault Log`: a diagnostic event view for crash, JS error, C++ crash, app killed, and unknown raw fault entries.

`Fault Log` should be the priority for this stage, but `HiLog` remains available because live logs are still useful during reproduction.

## MVP Scope

The MVP includes:

- Refresh fault logs from the selected device.
- Parse returned raw text into structured fault entries.
- Display a fault list optimized for scanning.
- Show selected fault details in an inspector.
- Filter by type, bundle/process, pid, and text/regex.
- Copy summary and raw detail.
- Handle empty, unavailable, unauthorized, command failed, and parse-fallback states.

The MVP excludes:

- Offline `hilogtool parse`.
- Bugreport capture.
- Screen capture and screen recording.
- Persisted custom filters.
- Saved reports or zipped diagnostic bundles.
- Deep stack-frame symbolication.
- Multi-device comparison.

## Backend Design

Reuse the current Tauri `DeviceLogRuntime` for process ownership and HDC access. Add one new fault-log command beside the current device-log commands:

- `list_device_fault_logs(request)`

The first MVP must not delete logs on the device. Clearing means clearing ArkLine's in-memory view only.

The backend returns raw fault payloads plus command metadata:

```ts
type DeviceFaultLogFetchResult = {
  deviceId: string;
  fetchedAt: string;
  entries: DeviceFaultLogRawEntry[];
  command: string;
  stderr: string;
  status: "ok" | "empty" | "unavailable" | "unauthorized" | "error";
  message: string;
};
```

The backend should be conservative about HDC commands. It should first use available command output and known accessible locations, and all command failures must become structured UI states instead of throwing unhandled errors.

## Frontend Domain Model

Create a fault-log domain under `src/features/device-log` rather than a new feature root:

- `device-fault-log-model.ts`
- `device-fault-log-parser.ts`
- `device-fault-log-filter.ts`
- `device-fault-log-store.ts`

Core entry shape:

```ts
type DeviceFaultLogType =
  | "jsCrash"
  | "cppCrash"
  | "appFreeze"
  | "appKilled"
  | "sysWarning"
  | "unknown";

type DeviceFaultLogEntry = {
  id: string;
  deviceId: string;
  type: DeviceFaultLogType;
  severity: "fatal" | "error" | "warning" | "unknown";
  timestamp: string | null;
  bundleName: string;
  processName: string;
  pid: number | null;
  reason: string;
  summary: string;
  stack: string[];
  raw: string;
};
```

The parser must preserve raw text even when it cannot classify the fault. Unknown entries are still useful because engineers can copy and inspect them.

## UI Design

`DeviceLogToolWindow` should become a small workbench shell:

- Shared header: device selector, refresh devices, connection/status summary.
- Internal tabs: `HiLog`, `Fault Log`.
- `HiLog` keeps current stream controls.
- `Fault Log` shows refresh, filter, copy, and clear-view actions.

Fault Log layout:

- Left/main list: type, time, bundle/process, reason summary.
- Right inspector: selected entry fields and raw log.
- Compact mode: if the bottom window is narrow, inspector moves below or collapses behind a details toggle.

The visual style should stay IDE-like: dense, low decoration, clear hierarchy, stable columns, restrained severity colors.

## Filtering And Actions

MVP filters:

- Type segmented control: All, JS, C++, Freeze, Killed, Unknown.
- Text input with regex and match-case toggles.
- Bundle/process text field.
- PID field.

MVP actions:

- Refresh.
- Copy summary.
- Copy raw.
- Clear view.
- Select first result after refresh.
- Preserve selection if the refreshed entry still exists.

Regex errors should be inline and non-destructive: the previous visible result set should remain understandable and the UI must not crash.

## Error Handling

Required states:

- `idle`: no fetch yet.
- `loading`: fetch in progress.
- `ready`: entries loaded.
- `empty`: command succeeded but no entries were found.
- `unavailable`: HDC or fault-log command is unavailable.
- `unauthorized`: device is connected but not authorized.
- `error`: command failed or returned malformed data.

Error messages must include the selected device and a short command-level explanation. Raw stderr can be available in details but should not dominate the main UI.

## Testing

Frontend tests:

- Parser classifies representative JS crash, C++ crash, app killed, and unknown raw entries.
- Filter supports type, bundle/process, pid, text, regex, and invalid regex.
- Store preserves selected entry across refresh when possible.
- UI shows Fault Log tab, refreshes entries, selects an entry, displays inspector details, copies summary/raw, and handles empty/error states.

Rust tests:

- Command output parsing converts raw chunks into raw fault entries.
- HDC failure output maps to `unavailable`, `unauthorized`, or `error`.
- Empty output maps to `empty`.

Integration checks:

- `pnpm test -- tests/frontend/device-fault-log-domain.test.ts tests/frontend/device-fault-log-tool-window.test.tsx`
- `cargo test --manifest-path src-tauri/Cargo.toml device_log_service`
- `pnpm test`
- `pnpm build`

## Rollout Plan

1. Add fault-log domain model, parser, filter, and store with deterministic fixtures.
2. Add workspace API contract and demo fault-log data.
3. Split `DeviceLogToolWindow` into workbench shell plus `HiLog` and `Fault Log` panels.
4. Add Fault Log UI with list, inspector, refresh, filters, copy, and clear-view.
5. Add Tauri fault-log fetch command with conservative HDC execution and structured failure states.
6. Run focused and full verification.

## Risks

The largest uncertainty is the exact HDC command/path shape for fault logs across HarmonyOS SDK/device versions. The implementation must isolate command discovery and map failures cleanly instead of assuming one device layout. If a real device is unavailable during development, demo fixtures and parser tests still provide most coverage, but a final manual smoke on a connected engineering device remains necessary.

## Self-Review

- No placeholder requirements remain.
- Scope is focused on Fault Log MVP and explicitly excludes broader diagnostics.
- Architecture reuses the existing Device Log/HDC foundation.
- UI behavior is specific enough to plan and test.
- The command uncertainty is called out as an implementation risk rather than hidden inside the plan.
