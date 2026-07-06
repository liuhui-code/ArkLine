import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceLogStorageHealth, WorkspaceApi } from "@/features/workspace/workspace-api";

const STORAGE_HEALTH_REFRESH_MS = 15_000;
const DEVICE_LOG_RETENTION_TARGET_BYTES = 512 * 1024 * 1024;

type UseDeviceLogStorageHealthOptions = {
  active: boolean;
  canClear: boolean;
  onStatusChange: (status: string) => void;
  workspaceApi: WorkspaceApi;
};

export function useDeviceLogStorageHealth({
  active,
  canClear,
  onStatusChange,
  workspaceApi,
}: UseDeviceLogStorageHealthOptions) {
  const [clearing, setClearing] = useState(false);
  const [applyingRetention, setApplyingRetention] = useState(false);
  const [health, setHealth] = useState<DeviceLogStorageHealth | null>(null);
  const refreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!workspaceApi.getDeviceLogStorageHealth) {
      setHealth(null);
      return;
    }
    if (refreshingRef.current) {
      return;
    }
    refreshingRef.current = true;
    try {
      setHealth(await workspaceApi.getDeviceLogStorageHealth());
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Device log storage health unavailable");
    } finally {
      refreshingRef.current = false;
    }
  }, [onStatusChange, workspaceApi]);

  useEffect(() => {
    if (!active) {
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), STORAGE_HEALTH_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [active, refresh]);

  async function clearStorage() {
    if (!workspaceApi.clearDeviceLogStorage) {
      onStatusChange("Device log storage clear unavailable");
      return;
    }
    if (!canClear) {
      onStatusChange("Stop Device Log stream before clearing storage");
      return;
    }

    setClearing(true);
    onStatusChange("Clearing device log storage...");
    try {
      const result = await workspaceApi.clearDeviceLogStorage();
      onStatusChange(`Device log storage cleared: ${result.removedFileCount.toLocaleString()} files`);
      await refresh();
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Device log storage clear failed");
    } finally {
      setClearing(false);
    }
  }

  async function applyRetention() {
    if (!workspaceApi.applyDeviceLogRetention) {
      onStatusChange("Device log retention unavailable");
      return;
    }
    if (!canClear) {
      onStatusChange("Stop Device Log stream before applying retention");
      return;
    }

    setApplyingRetention(true);
    onStatusChange("Applying device log retention...");
    try {
      const result = await workspaceApi.applyDeviceLogRetention(DEVICE_LOG_RETENTION_TARGET_BYTES);
      onStatusChange(`Device log retention applied: ${result.removedFileCount.toLocaleString()} files`);
      await refresh();
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Device log retention failed");
    } finally {
      setApplyingRetention(false);
    }
  }

  return {
    applyRetention,
    applyingRetention,
    clearStorage,
    clearing,
    health,
  };
}
