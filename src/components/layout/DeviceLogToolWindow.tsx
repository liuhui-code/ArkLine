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

export function DeviceLogToolWindow({
  active,
  workspaceApi,
  onStatusChange,
}: DeviceLogToolWindowProps) {
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
          {devices.length === 0 ? <option value="">No devices</option> : null}
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
