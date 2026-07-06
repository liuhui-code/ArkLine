import type { BuildConfiguration } from "@/features/build/build-model";
import type { DeviceFaultLogFetchResult } from "@/features/device-log/device-fault-log-model";
import { defaultSettings, type AppSettings } from "@/features/settings/settings-store";
import {
  browserBuildConfigurationStore,
  demoWorkspace,
} from "@/features/workspace/workspace-api-browser-support";
import type {
  DeviceLogDevice,
  DeviceLogQueryResponse,
  DeviceLogQueryWorkerEvent,
  DeviceLogQueryWorkerStats,
  DeviceLogRetentionApplyResult,
  DeviceLogRetentionPlan,
  DeviceLogRuntimeStats,
  DeviceLogStorageClearResult,
  DeviceLogStorageHealth,
  DeviceLogStreamSummary,
  TerminalRunResult,
  TerminalSessionSummary,
  WorkspaceApi,
} from "@/features/workspace/workspace-api-contract";
import { hasTauriRuntime, invoke } from "@/features/workspace/workspace-api-runtime";
import { normalizePath } from "@/features/workspace/workspace-store";

export function createWorkspaceRuntimeApi(): Partial<WorkspaceApi> {
  return {
    async loadSettings() {
      return hasTauriRuntime() ? invoke<AppSettings>("load_settings") : defaultSettings();
    },
    async saveSettings(settings) {
      if (hasTauriRuntime()) {
        await invoke("save_settings", { settings });
      }
    },
    async loadBuildConfigurations(rootPath) {
      if (hasTauriRuntime()) {
        return invoke<BuildConfiguration[]>("load_build_configurations", { rootPath });
      }
      return browserBuildConfigurationStore.get(normalizePath(rootPath)) ?? [];
    },
    async saveBuildConfigurations(rootPath, configurations) {
      if (hasTauriRuntime()) {
        await invoke("save_build_configurations", { rootPath, configurations });
        return;
      }
      browserBuildConfigurationStore.set(normalizePath(rootPath), configurations);
    },
    async createTerminalSession(request) {
      if (hasTauriRuntime()) {
        return invoke<TerminalSessionSummary>("create_terminal_session", { request });
      }

      return {
        id: "session-1",
        title: "pwsh",
        cwd: normalizePath(request.cwd ?? demoWorkspace.rootPath),
        shell: "pwsh",
        status: "idle",
      };
    },
    async listTerminalSessions() {
      return hasTauriRuntime() ? invoke<TerminalSessionSummary[]>("list_terminal_sessions") : [];
    },
    async writeTerminalInput(request) {
      if (hasTauriRuntime()) {
        await invoke("write_terminal_input", { request });
      }
    },
    async resizeTerminalSession(request) {
      if (hasTauriRuntime()) {
        await invoke("resize_terminal_session", { request });
      }
    },
    async closeTerminalSession(sessionId) {
      if (hasTauriRuntime()) {
        await invoke("close_terminal_session", { sessionId });
      }
    },
    async stopTerminalSession(sessionId) {
      if (hasTauriRuntime()) {
        await invoke("stop_terminal_session", { sessionId });
      }
    },
    async runTerminalCommand(request) {
      if (hasTauriRuntime()) {
        return invoke<TerminalRunResult>("run_terminal_command", { request });
      }

      return {
        runId: request.runId,
        command: request.command,
        stdout: `${request.command} ok`,
        stderr: "",
        exitCode: 0,
        durationMs: 12,
        stopped: false,
      };
    },
    async stopTerminalCommand(runId) {
      if (hasTauriRuntime()) {
        await invoke("stop_terminal_command", { runId });
      }
    },
    async listDeviceLogDevices() {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogDevice[]>("list_device_log_devices");
      }

      return [{
        id: "demo-device",
        label: "Demo HarmonyOS Device",
        status: "online",
        detail: "Mock HiLog stream",
      }];
    },
    async listDeviceFaultLogs(request) {
      if (hasTauriRuntime()) {
        return invoke<DeviceFaultLogFetchResult>("list_device_fault_logs", { request });
      }
      return demoFaultLogResult(request.deviceId);
    },
    async startDeviceLogStream(request) {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogStreamSummary>("start_device_log_stream", { request });
      }

      return {
        streamId: "demo-device-log-stream",
        deviceId: "demo-device",
        status: "running",
      };
    },
    async stopDeviceLogStream(streamId) {
      if (hasTauriRuntime()) {
        await invoke("stop_device_log_stream", { streamId });
      }
    },
    async queryDeviceLogs(request) {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogQueryResponse>("query_device_logs", { request });
      }
      return {
        rows: [],
        totalCandidates: 0,
        scannedLines: 0,
        truncated: false,
        nextCursorSeq: null,
        budgetExceeded: false,
        queryMs: 0,
      };
    },
    async exportDeviceLogs(request) {
      if (hasTauriRuntime()) {
        return invoke<string>("export_device_logs", { request });
      }
      return "";
    },
    async exportDeviceLogsToFile(request, path) {
      if (hasTauriRuntime()) {
        await invoke("export_device_logs_to_file", { request, path });
      }
    },
    async getDeviceLogStats(streamId) {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogRuntimeStats>("get_device_log_stats", { streamId });
      }
      return {
        streamId,
        deviceId: "demo-device",
        streamStatus: "idle",
        ingestedLines: 0,
        persistedLines: 0,
        droppedLines: 0,
        pendingBatches: 0,
        bufferBytes: 0,
        lastWriteMs: 0,
        slowWriteBatches: 0,
        backpressureState: "idle",
        lastError: null,
      };
    },
    async getDeviceLogQueryWorkerStats() {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogQueryWorkerStats>("get_device_log_query_worker_stats");
      }
      return {
        running: false,
        queued: 0,
        completedQueries: 0,
        cancelledQueries: 0,
        failedQueries: 0,
        lastQueryMs: 0,
        lastError: null,
      };
    },
    async getDeviceLogQueryWorkerEvents() {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogQueryWorkerEvent[]>("get_device_log_query_worker_events");
      }
      return [];
    },
    async getDeviceLogStorageHealth() {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogStorageHealth>("get_device_log_storage_health");
      }
      return {
        rootPath: "",
        totalBytes: 0,
        segmentFileCount: 0,
        segmentBytes: 0,
        metadataBytes: 0,
        metadataBatchCount: 0,
        metadataLineCount: 0,
        oldestReceivedAtMs: null,
        newestReceivedAtMs: null,
        pressureState: "healthy",
        recommendedAction: "none",
      };
    },
    async clearDeviceLogStorage() {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogStorageClearResult>("clear_device_log_storage");
      }
      return {
        removedFileCount: 0,
        removedBytes: 0,
      };
    },
    async planDeviceLogRetention(targetBytes) {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogRetentionPlan>("plan_device_log_retention", { targetBytes });
      }
      return {
        currentBytes: 0,
        targetBytes,
        removeFileCount: 0,
        removeBytes: 0,
        candidates: [],
      };
    },
    async applyDeviceLogRetention(targetBytes) {
      if (hasTauriRuntime()) {
        return invoke<DeviceLogRetentionApplyResult>("apply_device_log_retention", { targetBytes });
      }
      return {
        removedFileCount: 0,
        removedBytes: 0,
      };
    },
  };
}

function demoFaultLogResult(deviceId: string): DeviceFaultLogFetchResult {
  if (deviceId !== "demo-device") {
    return {
      deviceId,
      fetchedAt: "2026-06-25T15:21:48.000Z",
      entries: [],
      command: `hdc -t ${deviceId} shell faultlog -l`,
      stderr: "",
      status: "unavailable",
      message: "Device fault log demo data is only available for demo-device",
    };
  }

  return {
    deviceId,
    fetchedAt: "2026-06-25T15:21:48.000Z",
    entries: [
      {
        id: "demo-fault-1",
        raw: [
          "Timestamp: 2026-06-25 15:21:48",
          "Reason: JS_ERROR",
          "Process: com.demo.camera",
          "PID: 4321",
          "BundleName: com.demo.camera",
          "Summary: Render pipeline crashed in demo mode",
          "Error: TypeError: undefined is not a function",
          "Stacktrace:",
          "  at render (pages/index.ets:12:3)",
          "  at update (pages/app.ets:44:9)",
        ].join("\n"),
      },
      {
        id: "demo-fault-2",
        raw: [
          "Timestamp: 2026-06-25 15:19:10",
          "Reason: APP_FREEZE",
          "Process: com.demo.camera",
          "PID: 4321",
          "Summary: Main thread blocked by image decode",
        ].join("\n"),
      },
    ],
    command: `hdc -t ${deviceId} shell faultlog -l`,
    stderr: "",
    status: "ready",
    message: "ok",
  };
}
