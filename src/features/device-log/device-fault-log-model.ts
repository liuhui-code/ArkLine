export type DeviceFaultLogFetchStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "unavailable"
  | "unauthorized"
  | "error";

export type DeviceFaultLogType =
  | "jsCrash"
  | "cppCrash"
  | "appFreeze"
  | "appKilled"
  | "sysWarning"
  | "unknown";

export type DeviceFaultLogSeverity = "fatal" | "error" | "warning" | "unknown";

export type DeviceFaultLogRawEntry = {
  id: string;
  raw: string;
};

export type DeviceFaultLogFetchResult = {
  deviceId: string;
  fetchedAt: string;
  entries: DeviceFaultLogRawEntry[];
  command: string;
  stderr: string;
  status: DeviceFaultLogFetchStatus;
  message: string;
};

export type DeviceFaultLogEntry = {
  id: string;
  rawId: string;
  deviceId: string;
  type: DeviceFaultLogType;
  severity: DeviceFaultLogSeverity;
  timestamp: string | null;
  bundleName: string;
  processName: string;
  pid: number | null;
  reason: string;
  summary: string;
  stack: string[];
  raw: string;
};

export type DeviceFaultLogParsedResult = {
  deviceId: string;
  fetchedAt: string;
  entries: DeviceFaultLogEntry[];
  command: string;
  stderr: string;
  status: DeviceFaultLogFetchStatus;
  message: string;
};

export type DeviceFaultLogFilterState = {
  query: string;
  regex: boolean;
  matchCase: boolean;
  type: "all" | DeviceFaultLogType;
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
  entries: DeviceFaultLogEntry[];
  filter: DeviceFaultLogFilterState;
  selectedEntryId: string | null;
  deviceId: string | null;
  fetchedAt: string | null;
  command: string;
  stderr: string;
  message: string;
};
