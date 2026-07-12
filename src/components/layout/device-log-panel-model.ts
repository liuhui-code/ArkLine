import type { DeviceLogEntry } from "@/features/device-log/device-log-model";
import type { DeviceLogRuntimeStats } from "@/features/workspace/workspace-api";

export type DeviceLogRenderWindowInput = {
  entries: DeviceLogEntry[];
  followingTail: boolean;
  rowHeight: number;
  overscan: number;
  scrollTop: number;
  viewportHeight: number;
};

export function buildDeviceLogRenderWindow({
  entries,
  followingTail,
  rowHeight,
  overscan,
  scrollTop,
  viewportHeight,
}: DeviceLogRenderWindowInput) {
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const scrollStartIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const tailStartIndex = Math.max(0, entries.length - visibleCount);
  const visibleStartIndex = followingTail ? tailStartIndex : scrollStartIndex;
  return {
    renderedEntries: entries.slice(visibleStartIndex, visibleStartIndex + visibleCount),
    visibleStartIndex,
    virtualTop: visibleStartIndex * rowHeight,
    virtualHeight: entries.length * rowHeight,
  };
}

export function buildDeviceLogLiveWindowText({
  liveEntryCount,
  sourceEntryCount,
  trimmedEntries,
  visibleEntryCount,
  queryActive,
}: {
  liveEntryCount: number;
  sourceEntryCount: number;
  trimmedEntries: number;
  visibleEntryCount: number;
  queryActive: boolean;
}) {
  if (trimmedEntries > 0 && !queryActive) {
    return `${liveEntryCount.toLocaleString()} live · ${trimmedEntries.toLocaleString()} older persisted`;
  }
  return `${sourceEntryCount.toLocaleString()} total · ${visibleEntryCount.toLocaleString()} matched`;
}

export function createStatsPollingErrorStats(
  streamId: string,
  deviceId: string,
  error: unknown,
): DeviceLogRuntimeStats {
  const message = error instanceof Error ? error.message : "Device log stats unavailable";
  return {
    streamId,
    deviceId,
    streamStatus: "error",
    ingestedLines: 0,
    persistedLines: 0,
    droppedLines: 0,
    pendingBatches: 0,
    bufferBytes: 0,
    lastWriteMs: 0,
    slowWriteBatches: 0,
    backpressureState: "idle",
    lastError: message,
  };
}
