import { useMemo, useState } from "react";
import { applyDeviceFaultLogFilter, compileDeviceFaultLogFilter } from "@/features/device-log/device-fault-log-filter";
import type {
  DeviceFaultLogEntry,
  DeviceFaultLogFetchStatus,
  DeviceFaultLogFilterState,
} from "@/features/device-log/device-fault-log-model";
import { createDeviceFaultLogStore } from "@/features/device-log/device-fault-log-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

const initialFilter: DeviceFaultLogFilterState = {
  query: "",
  regex: false,
  matchCase: false,
  type: "all",
  process: "",
  pid: "",
};

type DeviceFaultLogPanelProps = {
  active: boolean;
  deviceId: string;
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

async function writeClipboardText(value: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }

  await navigator.clipboard.writeText(value);
  return true;
}

function summarizeEntry(entry: DeviceFaultLogEntry) {
  return [
    `Type: ${entry.type}`,
    `Severity: ${entry.severity}`,
    `Process: ${entry.processName || "-"}`,
    `PID: ${entry.pid ?? "-"}`,
    `Bundle: ${entry.bundleName || "-"}`,
    `Reason: ${entry.reason || "-"}`,
    `Summary: ${entry.summary || "-"}`,
  ].join("\n");
}

export function DeviceFaultLogPanel({
  active,
  deviceId,
  workspaceApi,
  onStatusChange,
}: DeviceFaultLogPanelProps) {
  const [filter, setFilter] = useState(initialFilter);
  const [status, setStatus] = useState<DeviceFaultLogFetchStatus>("idle");
  const [storeVersion, setStoreVersion] = useState(0);
  const store = useMemo(() => createDeviceFaultLogStore(), []);
  const compiledFilter = useMemo(() => compileDeviceFaultLogFilter(filter), [filter]);
  const state = store.getState();
  const visibleEntries = state.entries.filter((entry) => applyDeviceFaultLogFilter(entry, compiledFilter));
  const selectedEntry = state.entries.find((entry) => entry.id === state.selectedEntryId) ?? visibleEntries[0] ?? null;

  function rerender() {
    setStoreVersion((value) => value + 1);
  }

  function updateFilter(patch: Partial<DeviceFaultLogFilterState>) {
    const nextFilter = { ...filter, ...patch };
    setFilter(nextFilter);
    store.setFilter(nextFilter);
    rerender();
  }

  async function refreshFaultLogs() {
    if (!deviceId) {
      setStatus("unavailable");
      onStatusChange("Select a device before refreshing fault logs");
      return;
    }

    setStatus("loading");
    onStatusChange("Refreshing fault logs");
    try {
      const result = await workspaceApi.listDeviceFaultLogs({ deviceId });
      store.replace(result);
      setStatus(result.status);
      onStatusChange(result.message || `Fault log status: ${result.status}`);
      rerender();
    } catch (error) {
      setStatus("error");
      onStatusChange(error instanceof Error ? error.message : "Fault log refresh failed");
    }
  }

  async function copySelectedSummary() {
    if (!selectedEntry) {
      return;
    }

    const copied = await writeClipboardText(summarizeEntry(selectedEntry)).catch(() => false);
    if (copied) {
      onStatusChange("Copied fault summary");
    }
  }

  async function copySelectedRaw() {
    if (!selectedEntry) {
      return;
    }

    const copied = await writeClipboardText(selectedEntry.raw).catch(() => false);
    if (copied) {
      onStatusChange("Copied fault raw log");
    }
  }

  function clearFaultLogView() {
    store.clearView();
    setStatus("idle");
    onStatusChange("Cleared fault log view");
    rerender();
  }

  void active;
  void storeVersion;

  return (
    <div className="device-log-tool-window__body">
      <header className="device-log-tool-window__toolbar">
        <button type="button" onClick={() => void refreshFaultLogs()} aria-label="Refresh Fault Logs">
          Refresh Fault Logs
        </button>
        <button type="button" onClick={() => void copySelectedSummary()} aria-label="Copy Fault Summary" disabled={!selectedEntry}>
          Copy Fault Summary
        </button>
        <button type="button" onClick={() => void copySelectedRaw()} aria-label="Copy Fault Raw" disabled={!selectedEntry}>
          Copy Fault Raw
        </button>
        <button type="button" onClick={clearFaultLogView} aria-label="Clear Fault Log View">
          Clear Fault Log View
        </button>
      </header>
      <div className="device-log-tool-window__filters">
        <select
          aria-label="Fault log type"
          value={filter.type}
          onChange={(event) => updateFilter({ type: event.target.value as DeviceFaultLogFilterState["type"] })}
        >
          <option value="all">All Types</option>
          <option value="jsCrash">JS Crash</option>
          <option value="cppCrash">CPP Crash</option>
          <option value="appFreeze">App Freeze</option>
          <option value="appKilled">App Killed</option>
          <option value="sysWarning">System Warning</option>
          <option value="unknown">Unknown</option>
        </select>
        <input
          aria-label="Filter fault logs"
          value={filter.query}
          onChange={(event) => updateFilter({ query: event.target.value })}
          placeholder="Filter fault logs"
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
        <input
          aria-label="Fault log process"
          value={filter.process}
          onChange={(event) => updateFilter({ process: event.target.value })}
          placeholder="Process"
        />
        <input
          aria-label="Fault log pid"
          value={filter.pid}
          onChange={(event) => updateFilter({ pid: event.target.value })}
          placeholder="PID"
        />
        {compiledFilter.error ? <span className="device-log-tool-window__filter-error">{compiledFilter.error}</span> : null}
      </div>
      {status === "idle" ? <p className="device-log-tool-window__empty">Refresh fault logs to inspect device faults.</p> : null}
      {status === "loading" ? <p className="device-log-tool-window__empty">Loading fault logs…</p> : null}
      {status === "empty" ? <p className="device-log-tool-window__empty">No fault logs found.</p> : null}
      {status === "unavailable" ? <p className="device-log-tool-window__empty">{state.message || "Fault logs unavailable."}</p> : null}
      {status === "unauthorized" ? <p className="device-log-tool-window__empty">{state.message || "Device unauthorized."}</p> : null}
      {status === "error" ? <p className="device-log-tool-window__empty">{state.message || "Fault log refresh failed."}</p> : null}
      {status === "ready" ? (
        <div className="device-log-tool-window__fault-layout">
          <div className="device-log-tool-window__entries" role="list" aria-label="Fault Log Entries">
            {visibleEntries.length === 0 ? (
              <p className="device-log-tool-window__empty">No fault log entries match the current filters.</p>
            ) : (
              visibleEntries.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`device-log-tool-window__entry${selectedEntry?.id === entry.id ? " device-log-tool-window__entry--selected" : ""}`}
                  onClick={() => {
                    store.selectEntry(entry.id);
                    rerender();
                  }}
                >
                  <span>{entry.timestamp ?? "--"}</span>
                  <span>{entry.type}</span>
                  <span>{entry.processName || "-"}</span>
                  <span>{entry.summary}</span>
                </button>
              ))
            )}
          </div>
          <section aria-label="Fault Log Inspector" className="device-log-tool-window__inspector">
            {selectedEntry ? (
              <>
                <p>{selectedEntry.summary}</p>
                <dl>
                  <dt>Process</dt>
                  <dd>{selectedEntry.processName || "-"}</dd>
                  <dt>Bundle</dt>
                  <dd>{selectedEntry.bundleName || "-"}</dd>
                  <dt>PID</dt>
                  <dd>{selectedEntry.pid ?? "-"}</dd>
                  <dt>Reason</dt>
                  <dd>{selectedEntry.reason || "-"}</dd>
                </dl>
                <pre>{selectedEntry.raw}</pre>
              </>
            ) : (
              <p>Select a fault log entry.</p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
