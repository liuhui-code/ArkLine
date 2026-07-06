import type { DeviceLogEntry, DeviceLogFilterState } from "@/features/device-log/device-log-model";
import { canRunDeviceLogRenderRegex } from "@/features/device-log/device-log-regex-guard";
import type { DeviceLogQueryRequest, DeviceLogQueryRow } from "@/features/workspace/workspace-api";

export const DEVICE_LOG_QUERY_RECENT_WINDOW_MS = 60_000;
export const DEVICE_LOG_QUERY_LIMIT = 500;
export const DEVICE_LOG_QUERY_SCAN_BUDGET_LINES = 100_000;

export function buildDeviceLogQueryRequest(
  streamId: string,
  filter: DeviceLogFilterState,
  cursorSeq: number | null = null,
): DeviceLogQueryRequest {
  return {
    streamId,
    query: filter.query,
    regex: filter.regex,
    matchCase: filter.matchCase,
    levels: filter.levels,
    pid: filter.pid,
    process: filter.process,
    domain: filter.domain,
    tag: filter.tag,
    timeRangeMs: DEVICE_LOG_QUERY_RECENT_WINDOW_MS,
    limit: DEVICE_LOG_QUERY_LIMIT,
    cursorSeq,
    scanBudgetLines: DEVICE_LOG_QUERY_SCAN_BUDGET_LINES,
  };
}

export function queryRowToDeviceLogEntry(row: DeviceLogQueryRow, deviceId: string): DeviceLogEntry {
  return {
    id: `query-${row.seq}`,
    deviceId,
    raw: row.raw,
    receivedAt: row.receivedAtMs,
    timestamp: row.timestamp,
    level: normalizeLevel(row.level),
    pid: row.pid,
    tid: row.tid,
    process: row.process,
    domain: row.domain,
    tag: row.tag,
    message: row.message,
  };
}

export type DeviceLogHighlightRequest = Pick<DeviceLogFilterState, "query" | "regex" | "matchCase">;
export type DeviceLogHighlightRange = { start: number; end: number };

export function findDeviceLogHighlights(message: string, request: DeviceLogHighlightRequest): DeviceLogHighlightRange[] {
  if (!request.query.trim()) {
    return [];
  }
  return request.regex ? findRegexHighlights(message, request) : findPlainHighlights(message, request);
}

function findPlainHighlights(message: string, request: DeviceLogHighlightRequest) {
  const ranges: DeviceLogHighlightRange[] = [];
  const haystack = request.matchCase ? message : message.toLocaleLowerCase();
  const needle = request.matchCase ? request.query : request.query.toLocaleLowerCase();
  let index = haystack.indexOf(needle);
  while (index >= 0 && ranges.length < 100) {
    ranges.push({ start: index, end: index + needle.length });
    index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
  }
  return ranges;
}

function findRegexHighlights(message: string, request: DeviceLogHighlightRequest) {
  if (!canRunDeviceLogRenderRegex(message)) {
    return [];
  }

  try {
    const regex = new RegExp(request.query, request.matchCase ? "g" : "gi");
    const ranges: DeviceLogHighlightRange[] = [];
    for (const match of message.matchAll(regex)) {
      const value = match[0] ?? "";
      if (match.index == null || value.length === 0) {
        continue;
      }
      ranges.push({ start: match.index, end: match.index + value.length });
      if (ranges.length >= 100) {
        break;
      }
    }
    return ranges;
  } catch {
    return [];
  }
}

function normalizeLevel(level: string): DeviceLogEntry["level"] {
  if (level === "verbose" || level === "debug" || level === "info" || level === "warn" || level === "error" || level === "fatal") {
    return level;
  }
  return "unknown";
}
