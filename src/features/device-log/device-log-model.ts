export type DeviceConnectionStatus = "unknown" | "online" | "offline" | "unauthorized";

export type DeviceLogLevel = "verbose" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

export type DeviceLogDevice = {
  id: string;
  label: string;
  status: DeviceConnectionStatus;
  detail: string;
};

export type DeviceLogStreamStatus = "idle" | "starting" | "running" | "paused" | "stopping" | "error";

export type DeviceLogEntry = {
  id: string;
  deviceId: string;
  raw: string;
  timestamp: string | null;
  level: DeviceLogLevel;
  pid: number | null;
  tid: number | null;
  process: string;
  domain: string;
  tag: string;
  message: string;
};

export type DeviceLogFilterState = {
  query: string;
  regex: boolean;
  matchCase: boolean;
  levels: DeviceLogLevel[];
  pid: string;
  process: string;
  domain: string;
  tag: string;
};

export type CompiledDeviceLogFilter = {
  valid: boolean;
  error: string | null;
  state: DeviceLogFilterState;
  queryPattern: RegExp | null;
};

export type DeviceLogState = {
  entries: DeviceLogEntry[];
  pendingEntries: DeviceLogEntry[];
  filter: DeviceLogFilterState;
  paused: boolean;
};
