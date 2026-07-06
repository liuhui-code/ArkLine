import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceLogQueryWorkerEvent, WorkspaceApi } from "@/features/workspace/workspace-api";

const QUERY_WORKER_EVENTS_REFRESH_MS = 1_000;

type UseDeviceLogQueryWorkerEventsOptions = {
  active: boolean;
  workspaceApi: WorkspaceApi;
};

export function useDeviceLogQueryWorkerEvents({
  active,
  workspaceApi,
}: UseDeviceLogQueryWorkerEventsOptions) {
  const [events, setEvents] = useState<DeviceLogQueryWorkerEvent[]>([]);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!workspaceApi.getDeviceLogQueryWorkerEvents) {
      setEvents([]);
      return;
    }
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    try {
      setEvents(await workspaceApi.getDeviceLogQueryWorkerEvents());
    } catch {
      setEvents([]);
    } finally {
      refreshingRef.current = false;
    }
  }, [workspaceApi]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), QUERY_WORKER_EVENTS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  return events;
}
