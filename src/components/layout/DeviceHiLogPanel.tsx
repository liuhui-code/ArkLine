import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { DeviceLogEntriesView } from "@/components/layout/DeviceLogEntriesView";
import { DeviceLogFilterBar } from "@/components/layout/DeviceLogFilterBar";
import { DeviceLogInspector } from "@/components/layout/DeviceLogEntryDetails";
import { DeviceLogQueryDiagnostics } from "@/components/layout/DeviceLogQueryDiagnostics";
import { DeviceLogStreamToolbar } from "@/components/layout/DeviceLogStreamToolbar";
import {
  buildDeviceLogLiveWindowText,
  buildDeviceLogRenderWindow,
  createStatsPollingErrorStats,
} from "@/components/layout/device-log-panel-model";
import { applyDeviceLogFilter, compileDeviceLogFilter, hasActiveDeviceLogFilter } from "@/features/device-log/device-log-filter";
import type { DeviceLogEntry, DeviceLogFilterState, DeviceLogStreamStatus } from "@/features/device-log/device-log-model";
import { createDeviceLogStore } from "@/features/device-log/device-log-store";
import { useDeviceLogAutoRetry } from "@/features/device-log/use-device-log-auto-retry";
import { useDeviceLogExport } from "@/features/device-log/use-device-log-export";
import { useDeviceLogStorageHealth } from "@/features/device-log/use-device-log-storage-health";
import { useDeviceLogLiveBuffer } from "@/features/device-log/use-device-log-live-buffer";
import { useDeviceLogQueryController } from "@/features/device-log/use-device-log-query-controller";
import { useDeviceLogQueryWorkerEvents } from "@/features/device-log/use-device-log-query-worker-events";
import { useDeviceLogQueryWorkerStats } from "@/features/device-log/use-device-log-query-worker-stats";
import type { DeviceLogRuntimeStats, WorkspaceApi } from "@/features/workspace/workspace-api";

const QUERY_RECENT_WINDOW_MS = 60_000;
const LIVE_VIEW_CAPACITY = 10_000;
const LOG_ROW_HEIGHT = 26;
const LOG_ROW_OVERSCAN = 8;

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
  retryDelaysMs?: readonly number[];
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

export function DeviceHiLogPanel({
  active,
  deviceId,
  retryDelaysMs,
  workspaceApi,
  onStatusChange,
}: DeviceHiLogPanelProps) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamStatus, setStreamStatus] = useState<DeviceLogStreamStatus>("idle");
  const [filter, setFilter] = useState(initialFilter);
  const store = useMemo(() => createDeviceLogStore({ capacity: LIVE_VIEW_CAPACITY }), []);
  const currentDeviceIdRef = useRef(deviceId);
  const previousDeviceIdRef = useRef(deviceId);
  const streamIdRef = useRef<string | null>(null);
  const startRequestVersionRef = useRef(0);
  const entriesRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(260);
  const [followingTail, setFollowingTail] = useState(true);
  const [runtimeStats, setRuntimeStats] = useState<DeviceLogRuntimeStats | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<DeviceLogEntry | null>(null);
  const {
    appendLines,
    entries: stateEntries,
    livePaused,
    pendingLiveEntries,
    pauseLiveView: pauseBufferedLiveView,
    refreshLiveView,
    resetLiveView,
    resumeLiveView: resumeBufferedLiveView,
    storeState,
  } = useDeviceLogLiveBuffer({ deviceId, store });
  const compiledFilter = useMemo(() => compileDeviceLogFilter(filter), [filter]);
  const queryActive = hasActiveDeviceLogFilter(filter);
  const backendQueryActive = queryActive && streamId != null && compiledFilter.valid && workspaceApi.queryDeviceLogs != null;
  const query = useDeviceLogQueryController({
    active: backendQueryActive,
    deviceId,
    filter,
    onLoadedOlder: () => setFollowingTail(false),
    streamId,
    workspaceApi,
  });
  const queryEntries = query.entries;
  const sourceEntries = queryEntries ?? (queryActive ? store.getRecentEntries(QUERY_RECENT_WINDOW_MS) : stateEntries);
  const visibleEntries = queryEntries ?? sourceEntries.filter((entry) => applyDeviceLogFilter(entry, compiledFilter));
  const renderWindow = buildDeviceLogRenderWindow({
    entries: visibleEntries,
    followingTail,
    overscan: LOG_ROW_OVERSCAN,
    rowHeight: LOG_ROW_HEIGHT,
    scrollTop,
    viewportHeight,
  });
  const {
    canExport,
    exportCurrentLogs,
    exporting,
  } = useDeviceLogExport({
    deviceId,
    filter,
    filterValid: compiledFilter.valid,
    onStatusChange,
    streamId,
    workspaceApi,
  });
  const storage = useDeviceLogStorageHealth({
    active,
    canClear: streamStatus !== "running" && streamStatus !== "starting" && streamStatus !== "stopping",
    onStatusChange,
    workspaceApi,
  });
  const queryWorkerStats = useDeviceLogQueryWorkerStats({ active, workspaceApi });
  const queryWorkerEvents = useDeviceLogQueryWorkerEvents({ active, workspaceApi });

  useEffect(() => {
    currentDeviceIdRef.current = deviceId;
    startRequestVersionRef.current += 1;
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
  const {
    autoRetryExhausted,
    autoRetryMs,
    autoRetryPaused,
    clearAutoRetry,
    markHealthy,
    pauseAutoRetry,
    resetRetryBudget,
    resumeAutoRetry,
    scheduleAutoRetry,
  } = useDeviceLogAutoRetry({
    deviceId,
    retryDelaysMs,
    onExhausted: () => onStatusChange("Device log stream retry budget exhausted"),
    onRetry: () => void startStream({ force: true, preserveRetryBudget: true }),
  });

  useEffect(() => {
    function handleTestEvent(event: Event) {
      const detail = (event as CustomEvent<{ deviceId: string; lines: string[] }>).detail;
      appendLines(detail.deviceId, detail.lines);
    }

    document.addEventListener("arkline-device-log-lines", handleTestEvent);

    let disposed = false;
    let teardown: () => void = () => {};
    void listen<{ streamId: string; deviceId: string; lines: string[] }>("device-log-output", (event) => {
      if (event.payload.streamId !== streamIdRef.current) {
        return;
      }
      appendLines(event.payload.deviceId, event.payload.lines);
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        teardown = unlisten;
      })
      .catch(() => {
        if (!disposed) {
          teardown = () => {};
        }
      });

    return () => {
      disposed = true;
      startRequestVersionRef.current += 1;
      const activeStreamId = streamIdRef.current;
      streamIdRef.current = null;
      if (activeStreamId) {
        void stopBackendStream(activeStreamId, "Device log stream stopped");
      }
      clearAutoRetry();
      teardown();
      document.removeEventListener("arkline-device-log-lines", handleTestEvent);
    };
  }, [appendLines, clearAutoRetry, onStatusChange, workspaceApi]);

  useEffect(() => {
    const previousDeviceId = previousDeviceIdRef.current;
    if (previousDeviceId === deviceId) {
      return;
    }

    previousDeviceIdRef.current = deviceId;
    startRequestVersionRef.current += 1;
    store.clear();
    resetLiveView();
    setFilter(initialFilter);
    store.setFilter(initialFilter);
    setRuntimeStats(null);
    resetRetryBudget();

    const activeStreamId = streamIdRef.current;
    streamIdRef.current = null;
    setStreamId(null);
    setStreamStatus("idle");
    if (activeStreamId) {
      void stopBackendStream(activeStreamId, "Device log stream stopped");
    }
  }, [deviceId, onStatusChange, resetLiveView, resetRetryBudget, store, workspaceApi]);

  useEffect(() => {
    if (!active && streamStatus === "running") {
      onStatusChange("HiLog paused in background");
    }
  }, [active, onStatusChange, streamStatus]);

  useEffect(() => {
    if (streamStatus !== "running" || !streamId || !workspaceApi.getDeviceLogStats) {
      return;
    }
    let disposed = false;
    const refreshStats = () => {
      void workspaceApi.getDeviceLogStats?.(streamId)
        .then((stats) => {
          if (!disposed) {
            setRuntimeStats(stats);
          }
        })
        .catch((error: unknown) => {
          if (!disposed) {
            setRuntimeStats(createStatsPollingErrorStats(streamId, deviceId, error));
            void workspaceApi.stopDeviceLogStream(streamId).catch(() => undefined);
          }
        });
    };
    refreshStats();
    const timer = window.setInterval(refreshStats, 1_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [deviceId, streamId, streamStatus, workspaceApi]);

  useEffect(() => {
    if (!runtimeStats || streamStatus !== "running") {
      return;
    }
    if (runtimeStats.streamStatus === "running") {
      markHealthy();
      return;
    }
    if (runtimeStats.streamStatus === "error") {
      setStreamId(null);
      streamIdRef.current = null;
      setStreamStatus("error");
      onStatusChange(runtimeStats.lastError ?? "Device log stream error");
      scheduleAutoRetry();
      return;
    }
    if (runtimeStats.streamStatus === "stopped") {
      setStreamId(null);
      streamIdRef.current = null;
      setStreamStatus("idle");
      onStatusChange("Device log stream stopped");
    }
  }, [markHealthy, onStatusChange, runtimeStats, scheduleAutoRetry, streamStatus]);

  useEffect(() => {
    const element = entriesRef.current;
    if (!element || !followingTail) {
      return;
    }
    element.scrollTop = element.scrollHeight;
    setScrollTop(element.scrollTop);
  }, [followingTail, visibleEntries.length]);

  async function startStream(options?: { force?: boolean; preserveRetryBudget?: boolean }) {
    if (
      !deviceId
      || (!options?.force && (streamStatus === "running" || streamStatus === "starting"))
    ) {
      return;
    }

    const requestVersion = startRequestVersionRef.current;
    const requestedDeviceId = deviceId;
    clearAutoRetry();
    setRuntimeStats(null);
    setStreamStatus("starting");
    try {
      const stream = await workspaceApi.startDeviceLogStream({ deviceId: requestedDeviceId });
      const staleRequest = requestVersion !== startRequestVersionRef.current || requestedDeviceId !== currentDeviceIdRef.current;
      if (staleRequest) {
        await workspaceApi.stopDeviceLogStream(stream.streamId).catch(() => undefined);
        return;
      }
      setStreamId(stream.streamId);
      setStreamStatus("running");
      if (!options?.preserveRetryBudget) {
        markHealthy();
      }
      onStatusChange("Device log stream running");
    } catch (error) {
      if (requestVersion !== startRequestVersionRef.current || requestedDeviceId !== currentDeviceIdRef.current) {
        return;
      }
      setStreamStatus("error");
      onStatusChange(error instanceof Error ? error.message : "Device log stream failed");
    }
  }

  async function stopStream() {
    if (!streamId) {
      return;
    }

    setStreamStatus("stopping");
    resetRetryBudget();
    try {
      await workspaceApi.stopDeviceLogStream(streamId);
      setStreamId(null);
      setRuntimeStats(null);
      setStreamStatus("idle");
      onStatusChange("Device log stream stopped");
    } catch (error) {
      setStreamStatus("running");
      onStatusChange(error instanceof Error ? error.message : "Device log stream failed to stop");
    }
  }

  function updateFilter(patch: Partial<DeviceLogFilterState>) {
    const nextFilter = { ...filter, ...patch };
    setFilter(nextFilter);
    store.setFilter(nextFilter);
    query.reset();
    refreshLiveView();
  }

  function handleEntriesScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    setViewportHeight(element.clientHeight || viewportHeight);
    setFollowingTail(element.scrollHeight - element.scrollTop - element.clientHeight < LOG_ROW_HEIGHT * 2);
  }

  function followTail() {
    const element = entriesRef.current;
    if (!element) {
      return;
    }
    setFollowingTail(true);
    element.scrollTop = element.scrollHeight;
    setScrollTop(element.scrollTop);
  }

  function pauseLiveView() {
    pauseBufferedLiveView();
    onStatusChange("HiLog live view paused");
  }

  function resumeLiveView() {
    resumeBufferedLiveView();
    setFollowingTail(true);
    onStatusChange("HiLog live view resumed");
  }

  const liveWindowText = buildDeviceLogLiveWindowText({
    liveEntryCount: stateEntries.length,
    sourceEntryCount: sourceEntries.length,
    trimmedEntries: storeState.trimmedEntries,
    visibleEntryCount: visibleEntries.length,
    queryActive: queryEntries != null,
  });

  return (
    <div className="device-log-tool-window__body">
      <DeviceLogStreamToolbar
        autoRetryExhausted={autoRetryExhausted}
        autoRetryMs={autoRetryMs}
        autoRetryPaused={autoRetryPaused}
        livePaused={livePaused}
        pendingLiveEntries={pendingLiveEntries}
        queryWorkerStats={queryWorkerStats}
        runtimeStats={runtimeStats}
        storageHealth={storage.health}
        streamStatus={streamStatus}
        canExport={canExport}
        canClearStorage={streamStatus !== "running" && streamStatus !== "starting" && streamStatus !== "stopping"}
        applyingRetention={storage.applyingRetention}
        clearingStorage={storage.clearing}
        exporting={exporting}
        onClear={() => {
          store.clear();
          refreshLiveView();
          onStatusChange("HiLog view cleared");
        }}
        onApplyRetention={() => void storage.applyRetention()}
        onClearStorage={() => void storage.clearStorage()}
        onExport={() => void exportCurrentLogs()}
        onPauseLive={pauseLiveView}
        onPauseAutoRetry={pauseAutoRetry}
        onResumeLive={resumeLiveView}
        onResumeAutoRetry={resumeAutoRetry}
        onStart={() => void startStream()}
        onStop={() => void stopStream()}
      />
      <DeviceLogFilterBar
        error={compiledFilter.error}
        filter={filter}
        onChange={updateFilter}
        onClear={() => updateFilter(initialFilter)}
      />
      <DeviceLogQueryDiagnostics events={queryWorkerEvents} />
      <DeviceLogEntriesView
        entriesRef={entriesRef}
        filter={filter}
        followingTail={followingTail}
        liveWindowText={liveWindowText}
        querySummary={query.summary}
        renderedEntries={renderWindow.renderedEntries}
        selectedEntry={selectedEntry}
        virtualHeight={renderWindow.virtualHeight}
        virtualTop={renderWindow.virtualTop}
        visibleEntries={visibleEntries}
        canLoadOlder={query.canLoadOlder}
        loadingOlder={query.loadingOlder}
        querying={query.querying}
        onEntrySelect={setSelectedEntry}
        onFollowTail={followTail}
        onLoadOlder={() => void query.loadOlder()}
        onScroll={handleEntriesScroll}
      />
      <DeviceLogInspector
        entry={selectedEntry}
        onClose={() => setSelectedEntry(null)}
        onFilterDomain={(domain) => updateFilter({ domain })}
        onFilterPid={(pid) => updateFilter({ pid })}
        onFilterTag={(tag) => updateFilter({ tag })}
        onFilterProcess={(process) => updateFilter({ process })}
      />
    </div>
  );
}
