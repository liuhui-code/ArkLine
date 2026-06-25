import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import { applyDeviceLogFilter, compileDeviceLogFilter } from "@/features/device-log/device-log-filter";
import type { DeviceLogFilterState, DeviceLogStreamStatus } from "@/features/device-log/device-log-model";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

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

type DeviceHiLogPanelProps = {
  active: boolean;
  deviceId: string;
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

export function DeviceHiLogPanel({
  active,
  deviceId,
  workspaceApi,
  onStatusChange,
}: DeviceHiLogPanelProps) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<DeviceLogStreamStatus>("idle");
  const [filter, setFilter] = useState(initialFilter);
  const [storeVersion, setStoreVersion] = useState(0);
  const store = useMemo(() => createDeviceLogStore(), []);
  const currentDeviceIdRef = useRef(deviceId);
  const previousDeviceIdRef = useRef(deviceId);
  const streamIdRef = useRef<string | null>(null);
  const compiledFilter = useMemo(() => compileDeviceLogFilter(filter), [filter]);
  const visibleEntries = store.getState().entries.filter((entry) => applyDeviceLogFilter(entry, compiledFilter));

  useEffect(() => {
    currentDeviceIdRef.current = deviceId;
  }, [deviceId]);

  useEffect(() => {
    streamIdRef.current = streamId;
  }, [streamId]);

  async function stopBackendStream(activeStreamId: string, nextStatus: string) {
    try {
      await workspaceApi.stopDeviceLogStream(activeStreamId);
      onStatusChange(nextStatus);
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Device log stream failed to stop");
    }
  }

  useEffect(() => {
    function appendLines(nextDeviceId: string, lines: string[]) {
      if (!currentDeviceIdRef.current || nextDeviceId !== currentDeviceIdRef.current) {
        return;
      }

      store.appendRawLines(nextDeviceId, lines);
      setStoreVersion((value) => value + 1);
    }

    function handleTestEvent(event: Event) {
      const detail = (event as CustomEvent<{ deviceId: string; lines: string[] }>).detail;
      appendLines(detail.deviceId, detail.lines);
    }

    document.addEventListener("arkline-device-log-lines", handleTestEvent);

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
      const activeStreamId = streamIdRef.current;
      streamIdRef.current = null;
      if (activeStreamId) {
        void stopBackendStream(activeStreamId, "Device log stream stopped");
      }
      teardown();
      document.removeEventListener("arkline-device-log-lines", handleTestEvent);
    };
  }, [onStatusChange, store, workspaceApi]);

  useEffect(() => {
    const previousDeviceId = previousDeviceIdRef.current;
    if (previousDeviceId === deviceId) {
      return;
    }

    previousDeviceIdRef.current = deviceId;
    store.clear();
    setStoreVersion((value) => value + 1);
    setFilter(initialFilter);
    store.setFilter(initialFilter);

    const activeStreamId = streamIdRef.current;
    streamIdRef.current = null;
    setStreamId(null);
    setStreamStatus("idle");
    if (activeStreamId) {
      void stopBackendStream(activeStreamId, "Device log stream stopped");
    }
  }, [deviceId, onStatusChange, store, workspaceApi]);

  useEffect(() => {
    if (!active && streamStatus === "running") {
      onStatusChange("HiLog paused in background");
    }
  }, [active, onStatusChange, streamStatus]);

  async function startStream() {
    if (!deviceId || streamStatus === "running" || streamStatus === "starting") {
      return;
    }

    setStreamStatus("starting");
    try {
      const stream = await workspaceApi.startDeviceLogStream({ deviceId });
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
    <div className="device-log-tool-window__body">
      <header className="device-log-tool-window__toolbar">
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
            onStatusChange("HiLog view cleared");
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
    </div>
  );
}
