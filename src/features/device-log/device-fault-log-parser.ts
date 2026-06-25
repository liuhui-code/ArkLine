import type {
  DeviceFaultLogFetchResult,
  DeviceFaultLogParsedEntry,
  DeviceFaultLogRawEntry,
  DeviceFaultSeverity,
  DeviceFaultType,
} from "@/features/device-log/device-fault-log-model";

const multiLineFields = new Set(["stacktrace"]);

export function parseDeviceFaultLogEntries(result: DeviceFaultLogFetchResult): DeviceFaultLogParsedEntry[] {
  return result.entries.map(parseRawEntry);
}

function parseRawEntry(entry: DeviceFaultLogRawEntry): DeviceFaultLogParsedEntry {
  const rawText = entry.raw.replace(/\r\n/gu, "\n").trim();
  const fields = extractFields(rawText);
  const reason = firstField(fields, "reason");
  const summary = firstField(fields, "summary") || rawText;
  const error = firstField(fields, "error");
  const stacktrace = firstField(fields, "stacktrace")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return {
    id: entry.id,
    rawText,
    type: classifyFaultType(reason, summary, error),
    severity: classifySeverity(reason, summary, error),
    reason,
    process: firstField(fields, "process"),
    pid: parsePid(firstField(fields, "pid")),
    bundleName: firstField(fields, "bundlename"),
    timestamp: firstField(fields, "timestamp") || null,
    summary,
    error,
    stacktrace,
  };
}

function extractFields(rawText: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let currentKey = "";
  const lines = rawText.split("\n");

  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z0-9]*):\s?(.*)$/u.exec(line);
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

function classifyFaultType(reason: string, summary: string, error: string): DeviceFaultType {
  const text = `${reason}\n${summary}\n${error}`.toLocaleLowerCase();
  if (text.includes("js error") || text.includes("javascript")) {
    return "JS_ERROR";
  }
  if (text.includes("freeze") || text.includes("not responding") || text.includes("anr")) {
    return "APP_FREEZE";
  }
  if (text.includes("crash") || text.includes("abort") || text.includes("exception")) {
    return "APP_CRASH";
  }
  return "UNKNOWN";
}

function classifySeverity(reason: string, summary: string, error: string): DeviceFaultSeverity {
  const type = classifyFaultType(reason, summary, error);
  if (type === "JS_ERROR" || type === "APP_CRASH") {
    return "error";
  }
  if (type === "APP_FREEZE") {
    return "warning";
  }
  return "unknown";
}
