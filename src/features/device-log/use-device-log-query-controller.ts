import { useEffect, useRef, useState } from "react";
import type { DeviceLogEntry, DeviceLogFilterState } from "@/features/device-log/device-log-model";
import { buildDeviceLogQueryRequest, queryRowToDeviceLogEntry } from "@/features/device-log/device-log-query";
import type { DeviceLogQueryRequest, DeviceLogQueryResponse, WorkspaceApi } from "@/features/workspace/workspace-api";

type DeviceLogQueryControllerOptions = {
  active: boolean;
  deviceId: string;
  streamId: string | null;
  filter: DeviceLogFilterState;
  workspaceApi: WorkspaceApi;
  onLoadedOlder: () => void;
};

type PendingQuery = {
  generation: number;
  request: DeviceLogQueryRequest;
};

export function useDeviceLogQueryController({
  active,
  deviceId,
  streamId,
  filter,
  workspaceApi,
  onLoadedOlder,
}: DeviceLogQueryControllerOptions) {
  const [entries, setEntries] = useState<DeviceLogEntry[] | null>(null);
  const [summary, setSummary] = useState("");
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [querying, setQuerying] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const generationRef = useRef(0);
  const queryInFlightRef = useRef(false);
  const queuedQueryRef = useRef<PendingQuery | null>(null);

  async function runForegroundQuery(query: PendingQuery) {
    if (!workspaceApi.queryDeviceLogs) {
      return;
    }
    if (queryInFlightRef.current) {
      queuedQueryRef.current = query;
      setQuerying(true);
      return;
    }

    queryInFlightRef.current = true;
    setQuerying(true);
    try {
      const response = await workspaceApi.queryDeviceLogs(query.request);
      if (generationRef.current !== query.generation) {
        return;
      }
      setEntries(response.rows.map((row) => queryRowToDeviceLogEntry(row, deviceId)));
      setSummary(formatQuerySummary(response));
      setNextCursor(response.nextCursorSeq);
    } catch (error) {
      if (generationRef.current === query.generation) {
        setEntries([]);
        setSummary(error instanceof Error ? error.message : "Device log query failed");
        setNextCursor(null);
      }
    } finally {
      queryInFlightRef.current = false;
      const queuedQuery = queuedQueryRef.current;
      queuedQueryRef.current = null;
      if (queuedQuery && generationRef.current === queuedQuery.generation) {
        void runForegroundQuery(queuedQuery);
      } else {
        setQuerying(false);
      }
    }
  }

  useEffect(() => {
    if (!active || !streamId) {
      reset();
      return;
    }
    const generation = generationRef.current + 1;
    generationRef.current = generation;
    const request = buildDeviceLogQueryRequest(streamId, filter);
    const timer = window.setTimeout(() => {
      void runForegroundQuery({ generation, request });
    }, 150);
    return () => {
      window.clearTimeout(timer);
    };
  }, [active, deviceId, filter, streamId, workspaceApi]);

  function reset() {
    generationRef.current += 1;
    queuedQueryRef.current = null;
    setEntries(null);
    setSummary("");
    setNextCursor(null);
    setQuerying(false);
    setLoadingOlder(false);
  }

  async function loadOlder() {
    if (!streamId || !nextCursor || !workspaceApi.queryDeviceLogs) {
      return;
    }
    const generation = generationRef.current;
    setLoadingOlder(true);
    try {
      const request = buildDeviceLogQueryRequest(streamId, filter, nextCursor);
      const response = await workspaceApi.queryDeviceLogs(request);
      if (generationRef.current !== generation) {
        return;
      }
      const olderEntries = response.rows.map((row) => queryRowToDeviceLogEntry(row, deviceId));
      setEntries((current) => [...olderEntries, ...(current ?? [])]);
      setSummary(formatQuerySummary(response));
      setNextCursor(response.nextCursorSeq);
      onLoadedOlder();
    } catch (error) {
      if (generationRef.current === generation) {
        setSummary(error instanceof Error ? error.message : "Device log query failed");
      }
    } finally {
      if (generationRef.current === generation) {
        setLoadingOlder(false);
      }
    }
  }

  return {
    canLoadOlder: entries !== null && nextCursor != null,
    entries,
    loadOlder,
    loadingOlder,
    querying,
    reset,
    summary,
  };
}

function formatQuerySummary(response: DeviceLogQueryResponse) {
  const budgetText = formatQueryStopReason(response);
  return `${response.totalCandidates.toLocaleString()} candidates · ${response.scannedLines.toLocaleString()} scanned · ${response.queryMs}ms${budgetText}`;
}

function formatQueryStopReason(response: DeviceLogQueryResponse) {
  const continuationCursor = response.continuationCursorSeq ?? response.nextCursorSeq;
  const continuationText = continuationCursor == null ? "" : " · Load Older to continue";
  if (response.stopReason === "cancelled" || response.continuationReason === "cancelled") {
    return " · superseded by a newer query";
  }
  if (response.stopReason === "deadline") {
    return ` · time budget reached${continuationText}`;
  }
  if (response.stopReason === "scanBudget" || response.continuationReason === "scanBudget" || response.budgetExceeded) {
    return ` · scan budget reached${continuationText}`;
  }
  return "";
}
