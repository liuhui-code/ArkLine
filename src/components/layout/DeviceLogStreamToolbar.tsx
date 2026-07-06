import type { DeviceLogStreamStatus } from "@/features/device-log/device-log-model";
import type {
  DeviceLogQueryWorkerStats,
  DeviceLogRuntimeStats,
  DeviceLogStorageHealth,
} from "@/features/workspace/workspace-api";

type DeviceLogStreamToolbarProps = {
  autoRetryExhausted: boolean;
  autoRetryMs: number | null;
  autoRetryPaused: boolean;
  livePaused: boolean;
  pendingLiveEntries: number;
  queryWorkerStats: DeviceLogQueryWorkerStats | null;
  runtimeStats: DeviceLogRuntimeStats | null;
  storageHealth: DeviceLogStorageHealth | null;
  streamStatus: DeviceLogStreamStatus;
  canExport: boolean;
  canClearStorage: boolean;
  applyingRetention: boolean;
  clearingStorage: boolean;
  exporting: boolean;
  onClear: () => void;
  onClearStorage: () => void;
  onApplyRetention: () => void;
  onExport: () => void;
  onPauseLive: () => void;
  onPauseAutoRetry: () => void;
  onResumeLive: () => void;
  onResumeAutoRetry: () => void;
  onStart: () => void;
  onStop: () => void;
};

export function DeviceLogStreamToolbar({
  autoRetryExhausted,
  autoRetryMs,
  autoRetryPaused,
  livePaused,
  pendingLiveEntries,
  queryWorkerStats,
  runtimeStats,
  storageHealth,
  streamStatus,
  canExport,
  canClearStorage,
  applyingRetention,
  clearingStorage,
  exporting,
  onClear,
  onClearStorage,
  onApplyRetention,
  onExport,
  onPauseLive,
  onPauseAutoRetry,
  onResumeLive,
  onResumeAutoRetry,
  onStart,
  onStop,
}: DeviceLogStreamToolbarProps) {
  const statsText = formatRuntimeStats(runtimeStats);
  const queryWorkerText = formatQueryWorkerStats(queryWorkerStats);
  const storageText = formatStorageHealth(storageHealth);
  const canApplyRetention = canClearStorage && storageHealth?.recommendedAction !== "none";
  const startLabel = streamStatus === "error" ? "Retry" : "Start";
  const startAriaLabel = streamStatus === "error" ? "Retry Device Log Stream" : "Start Device Log Stream";

  return (
    <header className="device-log-tool-window__toolbar">
      <span className="device-log-tool-window__status">
        {streamStatus === "running" ? "Running" : streamStatus}
      </span>
      {streamStatus === "running" ? (
        <button type="button" onClick={onStop} aria-label="Stop Device Log Stream">
          Stop
        </button>
      ) : (
        <button type="button" onClick={onStart} aria-label={startAriaLabel}>
          {startLabel}
        </button>
      )}
      <button type="button" onClick={onClear}>
        Clear
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={!canExport || exporting}
        aria-label="Export Filtered Logs"
      >
        {exporting ? "Exporting..." : "Export"}
      </button>
      <button
        type="button"
        onClick={onClearStorage}
        disabled={!canClearStorage || clearingStorage || applyingRetention}
        aria-label="Clear Device Log Storage"
      >
        {clearingStorage ? "Clearing..." : "Clear Storage"}
      </button>
      {storageHealth?.recommendedAction !== "none" ? (
        <button
          type="button"
          onClick={onApplyRetention}
          disabled={!canApplyRetention || applyingRetention || clearingStorage}
          aria-label="Apply Device Log Retention"
        >
          {applyingRetention ? "Applying..." : "Apply Retention"}
        </button>
      ) : null}
      {livePaused ? (
        <button type="button" onClick={onResumeLive} aria-label="Resume Live Log View">
          Resume Live
        </button>
      ) : (
        <button type="button" onClick={onPauseLive} aria-label="Pause Live Log View">
          Pause Live
        </button>
      )}
      {livePaused ? (
        <span className="device-log-tool-window__status">
          {pendingLiveEntries.toLocaleString()} pending while paused
        </span>
      ) : null}
      {autoRetryMs != null ? (
        <button type="button" onClick={onPauseAutoRetry} aria-label="Pause Device Log Auto Retry">
          Pause Auto
        </button>
      ) : null}
      {autoRetryPaused ? (
        <button type="button" onClick={onResumeAutoRetry} aria-label="Resume Device Log Auto Retry">
          Resume Auto
        </button>
      ) : null}
      {autoRetryMs != null ? (
        <span className="device-log-tool-window__status">
          Auto retry in {Math.max(1, Math.ceil(autoRetryMs / 1_000))}s
        </span>
      ) : null}
      {autoRetryPaused ? (
        <span className="device-log-tool-window__status">Auto retry paused</span>
      ) : null}
      {autoRetryExhausted ? (
        <span className="device-log-tool-window__status">Auto retry stopped</span>
      ) : null}
      {storageText ? <span className="device-log-tool-window__status">{storageText}</span> : null}
      {queryWorkerText ? <span className="device-log-tool-window__status">{queryWorkerText}</span> : null}
      {statsText ? <span className="device-log-tool-window__status">{statsText}</span> : null}
    </header>
  );
}

function formatQueryWorkerStats(stats: DeviceLogQueryWorkerStats | null) {
  if (!stats) {
    return "";
  }
  const activity = stats.running ? "Query running" : "Query idle";
  const queued = stats.queued > 0 ? ` · ${stats.queued.toLocaleString()} queued` : "";
  const cancelled = stats.cancelledQueries > 0
    ? ` · ${stats.cancelledQueries.toLocaleString()} cancelled`
    : "";
  const failed = stats.failedQueries > 0 ? ` · ${stats.failedQueries.toLocaleString()} failed` : "";
  const last = stats.lastQueryMs > 0 ? ` · last ${stats.lastQueryMs.toLocaleString()}ms` : "";
  return `${activity}${queued}${cancelled}${failed}${last}`;
}

function formatRuntimeStats(runtimeStats: DeviceLogRuntimeStats | null) {
  if (!runtimeStats) {
    return "";
  }

  const pendingText = runtimeStats.pendingBatches > 0
    ? ` · ${runtimeStats.pendingBatches.toLocaleString()} pending`
    : "";
  const severityText = formatSeverityCounters(runtimeStats);
  const storageText = runtimeStats.bufferBytes > 0
    ? ` · ${formatByteCount(runtimeStats.bufferBytes)} persisted`
    : "";
  const writeLatencyText = runtimeStats.lastWriteMs > 0 ? ` · write ${runtimeStats.lastWriteMs}ms` : "";
  const slowWriteText = runtimeStats.slowWriteBatches > 0
    ? ` · ${runtimeStats.slowWriteBatches.toLocaleString()} slow`
    : "";
  const errorText = runtimeStats.lastError ? ` · ${runtimeStats.lastError}` : "";
  return `${runtimeStats.streamStatus} · ${runtimeStats.ingestedLines.toLocaleString()} lines${severityText}${storageText} · ${runtimeStats.droppedLines.toLocaleString()} dropped${pendingText}${writeLatencyText}${slowWriteText} · ${runtimeStats.backpressureState}${errorText}`;
}

function formatSeverityCounters(runtimeStats: DeviceLogRuntimeStats) {
  const errorLines = runtimeStats.errorLines ?? 0;
  const warnLines = runtimeStats.warnLines ?? 0;
  const fatalLines = runtimeStats.fatalLines ?? 0;
  if (errorLines === 0 && warnLines === 0 && fatalLines === 0) {
    return "";
  }
  return ` · E${errorLines.toLocaleString()} · W${warnLines.toLocaleString()} · F${fatalLines.toLocaleString()}`;
}

function formatStorageHealth(storageHealth: DeviceLogStorageHealth | null) {
  if (!storageHealth) {
    return "";
  }
  return `Storage ${storageHealth.pressureState} · ${formatByteCount(storageHealth.totalBytes)}`;
}

function formatByteCount(bytes: number) {
  if (bytes < 1024) {
    return `${bytes.toLocaleString()} B`;
  }

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const maximumFractionDigits = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toLocaleString(undefined, { maximumFractionDigits })} ${units[unitIndex]}`;
}
