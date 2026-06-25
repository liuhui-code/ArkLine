export type DeviceFaultLogFetchStatus = "idle" | "loading" | "success" | "error";

export type DeviceFaultType = "JS_ERROR" | "APP_CRASH" | "APP_FREEZE" | "UNKNOWN";

export type DeviceFaultSeverity = "info" | "warning" | "error" | "critical" | "unknown";

export type DeviceFaultLogRawEntry = {
  id: string;
  raw: string;
};

export type DeviceFaultLogFetchResult = {
  status: DeviceFaultLogFetchStatus;
  error: string | null;
  entries: DeviceFaultLogRawEntry[];
};

export type DeviceFaultLogParsedEntry = {
  id: string;
  rawText: string;
  type: DeviceFaultType;
  severity: DeviceFaultSeverity;
  reason: string;
  process: string;
  pid: number | null;
  bundleName: string;
  timestamp: string | null;
  summary: string;
  error: string;
  stacktrace: string[];
};

export type DeviceFaultLogFilterState = {
  query: string;
  regex: boolean;
  matchCase: boolean;
  types: DeviceFaultType[];
  process: string;
  pid: string;
};

export type CompiledDeviceFaultLogFilter = {
  valid: boolean;
  error: string | null;
  state: DeviceFaultLogFilterState;
  queryPattern: RegExp | null;
};

export type DeviceFaultLogStoreState = {
  status: DeviceFaultLogFetchStatus;
  error: string | null;
  entries: DeviceFaultLogParsedEntry[];
  filter: DeviceFaultLogFilterState;
  selectedEntryId: string | null;
};
