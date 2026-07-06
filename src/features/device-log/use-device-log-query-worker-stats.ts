import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceLogQueryWorkerStats, WorkspaceApi } from "@/features/workspace/workspace-api";

const QUERY_WORKER_STATS_REFRESH_MS = 1_000;

type UseDeviceLogQueryWorkerStatsOptions = {
  active: boolean;
  workspaceApi: WorkspaceApi;
};

export function useDeviceLogQueryWorkerStats({
  active,
  workspaceApi,
}: UseDeviceLogQueryWorkerStatsOptions) {
  const [stats, setStats] = useState<DeviceLogQueryWorkerStats | null>(null);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!workspaceApi.getDeviceLogQueryWorkerStats) {
      setStats(null);
      return;
    }
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    try {
      setStats(await workspaceApi.getDeviceLogQueryWorkerStats());
    } catch {
      setStats(null);
    } finally {
      refreshingRef.current = false;
    }
  }, [workspaceApi]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), QUERY_WORKER_STATS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  return stats;
}
