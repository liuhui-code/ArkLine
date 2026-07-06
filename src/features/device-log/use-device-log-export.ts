import { useState } from "react";
import { buildDeviceLogQueryRequest } from "@/features/device-log/device-log-query";
import type { DeviceLogFilterState } from "@/features/device-log/device-log-model";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type UseDeviceLogExportOptions = {
  deviceId: string;
  filter: DeviceLogFilterState;
  filterValid: boolean;
  streamId: string | null;
  workspaceApi: WorkspaceApi;
  onStatusChange: (status: string) => void;
};

export function useDeviceLogExport({
  deviceId,
  filter,
  filterValid,
  streamId,
  workspaceApi,
  onStatusChange,
}: UseDeviceLogExportOptions) {
  const [exporting, setExporting] = useState(false);
  const canExport = Boolean(streamId && filterValid && workspaceApi.pickSaveFile && workspaceApi.exportDeviceLogsToFile);

  async function exportCurrentLogs() {
    if (!streamId) {
      onStatusChange("Start HiLog before exporting");
      return;
    }
    if (!filterValid) {
      onStatusChange("Fix log filter before exporting");
      return;
    }
    if (!workspaceApi.pickSaveFile || !workspaceApi.exportDeviceLogsToFile) {
      onStatusChange("Device log export unavailable");
      return;
    }

    const path = await workspaceApi.pickSaveFile({
      defaultPath: `arkline-hilog-${deviceId || "device"}.log`,
      filters: [{ name: "Log", extensions: ["log", "txt"] }],
      title: "Export Device Logs",
    });
    if (!path) {
      onStatusChange("Device log export cancelled");
      return;
    }

    setExporting(true);
    onStatusChange("Exporting device logs...");
    try {
      await workspaceApi.exportDeviceLogsToFile(buildDeviceLogQueryRequest(streamId, filter), path);
      onStatusChange("Device logs exported");
    } catch (error) {
      onStatusChange(error instanceof Error ? error.message : "Device log export failed");
    } finally {
      setExporting(false);
    }
  }

  return { canExport, exporting, exportCurrentLogs };
}
