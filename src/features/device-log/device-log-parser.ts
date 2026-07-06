import type { DeviceLogEntry, DeviceLogLevel } from "@/features/device-log/device-log-model";

const levelMap: Record<string, DeviceLogLevel> = {
  V: "verbose",
  D: "debug",
  I: "info",
  W: "warn",
  E: "error",
  F: "fatal",
};

const hilogPattern = /^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})\s+(\d+)\s+(\d+)\s+([VDIWEF])\s+([^/\s]+)\/([^\s]+)\s+([^:]+):\s?(.*)$/u;

let nextEntryId = 0;

export function parseDeviceLogLine(raw: string, deviceId = "unknown"): DeviceLogEntry {
  const line = raw.replace(/\r?\n$/u, "");
  const match = hilogPattern.exec(line);
  const id = `log-${++nextEntryId}`;

  if (!match) {
    return {
      id,
      deviceId,
      raw: line,
      receivedAt: Date.now(),
      timestamp: null,
      level: "unknown",
      pid: null,
      tid: null,
      process: "",
      domain: "",
      tag: "",
      message: line,
    };
  }

  return {
    id,
    deviceId,
    raw: line,
    receivedAt: Date.now(),
    timestamp: match[1],
    pid: Number.parseInt(match[2], 10),
    tid: Number.parseInt(match[3], 10),
    level: levelMap[match[4]] ?? "unknown",
    domain: match[5],
    tag: match[6],
    process: match[7].trim(),
    message: match[8],
  };
}
