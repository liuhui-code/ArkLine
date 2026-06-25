import type {
  DeviceFaultLogEntry,
  DeviceFaultLogFetchResult,
  DeviceFaultLogParsedResult,
  DeviceFaultLogRawEntry,
  DeviceFaultLogSeverity,
  DeviceFaultLogType,
} from "@/features/device-log/device-fault-log-model";

const multiLineFields = new Set(["stacktrace"]);

export function parseDeviceFaultLogEntries(result: DeviceFaultLogFetchResult): DeviceFaultLogParsedResult {
  return {
    deviceId: result.deviceId,
    fetchedAt: result.fetchedAt,
    status: result.status,
    command: result.command,
    stderr: result.stderr,
    message: result.message,
    entries: result.entries.map((entry) => parseRawEntry(entry, result.deviceId)),
  };
}

function parseRawEntry(entry: DeviceFaultLogRawEntry, deviceId: string): DeviceFaultLogEntry {
  const raw = entry.raw.replace(/\r\n/gu, "\n").trim();
  const fields = extractFields(raw);
  const reason = firstField(fields, "reason");
  const summary = firstField(fields, "summary") || raw;

  return {
    id: entry.id,
    rawId: entry.id,
    deviceId,
    type: classifyFaultType(reason, summary, raw),
    severity: classifySeverity(reason, summary, raw),
    timestamp: firstField(fields, "timestamp") || null,
    bundleName: firstField(fields, "bundlename"),
    processName: firstField(fields, "process"),
    pid: parsePid(firstField(fields, "pid")),
    reason,
    summary,
    stack: firstField(fields, "stacktrace")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0),
    raw,
  };
}

function extractFields(raw: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey = "";

  for (const line of raw.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_]*):\s?(.*)$/u.exec(line);
    if (match) {
      currentKey = match[1].toLocaleLowerCase();
      fields[currentKey] = match[2];
      continue;
    }

    if (currentKey && multiLineFields.has(currentKey)) {
      fields[currentKey] = fields[currentKey]
        ? `${fields[currentKey]}\n${line}`
        : line;
    }
  }

  return fields;
}

function firstField(fields: Record<string, string>, key: string) {
  return (fields[key] ?? "").trim();
}

function parsePid(value: string) {
  if (!value) {
    return null;
  }

  const pid = Number.parseInt(value, 10);
  return Number.isNaN(pid) ? null : pid;
}

function classifyFaultType(reason: string, summary: string, raw: string): DeviceFaultLogType {
  const normalizedReason = reason.trim().toLocaleUpperCase();
  if (normalizedReason === "JS_ERROR") {
    return "jsCrash";
  }
  if (normalizedReason === "APP_CRASH") {
    return "cppCrash";
  }
  if (normalizedReason === "APP_FREEZE") {
    return "appFreeze";
  }

  const text = `${reason}\n${summary}\n${raw}`.toLocaleLowerCase();
  if (text.includes("js error")) {
    return "jsCrash";
  }
  if (text.includes("app crash") || text.includes("cpp crash")) {
    return "cppCrash";
  }
  if (text.includes("app freeze") || text.includes("freeze") || text.includes("anr")) {
    return "appFreeze";
  }

  return "unknown";
}

function classifySeverity(reason: string, summary: string, raw: string): DeviceFaultLogSeverity {
  const type = classifyFaultType(reason, summary, raw);
  if (type === "jsCrash" || type === "cppCrash") {
    return "fatal";
  }
  if (type === "appFreeze" || type === "sysWarning") {
    return "warning";
  }
  return "unknown";
}
