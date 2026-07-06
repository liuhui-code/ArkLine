export type DeviceConnectionStatus = "unknown" | "online" | "offline" | "unauthorized";

export type DeviceLogDevice = {
  id: string;
  label: string;
  status: DeviceConnectionStatus;
  detail: string;
};

export type StartDeviceLogStreamRequest = {
  deviceId: string;
};

export type ListDeviceFaultLogsRequest = {
  deviceId: string;
};

export type DeviceLogStreamSummary = {
  streamId: string;
  deviceId: string;
  status: "running";
};

export type DeviceLogQueryRequest = {
  streamId: string;
  query: string;
  regex: boolean;
  matchCase: boolean;
  levels: string[];
  pid: string;
  process: string;
  domain: string;
  tag: string;
  timeRangeMs: number;
  limit: number;
  cursorSeq: number | null;
  scanBudgetLines: number | null;
};

export type DeviceLogQueryRow = {
  seq: number;
  receivedAtMs: number;
  raw: string;
  timestamp: string | null;
  level: string;
  pid: number | null;
  tid: number | null;
  process: string;
  domain: string;
  tag: string;
  message: string;
};

export type DeviceLogQueryResponse = {
  rows: DeviceLogQueryRow[];
  totalCandidates: number;
  scannedLines: number;
  truncated: boolean;
  nextCursorSeq: number | null;
  continuationCursorSeq?: number | null;
  continuationReason?: "none" | "limit" | "scanBudget" | "deadline" | "cancelled";
  budgetExceeded: boolean;
  stopReason?: "complete" | "limit" | "scanBudget" | "deadline" | "cancelled";
  queryMs: number;
};

export type DeviceLogRuntimeStats = {
  streamId: string;
  deviceId: string;
  streamStatus: "idle" | "running" | "stopping" | "stopped" | "error";
  ingestedLines: number;
  persistedLines: number;
  droppedLines: number;
  pendingBatches: number;
  bufferBytes: number;
  lastWriteMs: number;
  slowWriteBatches: number;
  warnLines?: number;
  errorLines?: number;
  fatalLines?: number;
  backpressureState: string;
  lastError: string | null;
};

export type DeviceLogQueryWorkerStats = {
  running: boolean;
  queued: number;
  completedQueries: number;
  cancelledQueries: number;
  failedQueries: number;
  lastQueryMs: number;
  lastError: string | null;
};

export type DeviceLogQueryWorkerEvent = {
  sequence: number;
  streamId: string;
  query: string;
  status: "completed" | "cancelled" | "failed";
  durationMs: number;
  error: string | null;
};

export type DeviceLogStorageHealth = {
  rootPath: string;
  totalBytes: number;
  segmentFileCount: number;
  segmentBytes: number;
  metadataBytes: number;
  metadataBatchCount: number;
  metadataLineCount: number;
  oldestReceivedAtMs: number | null;
  newestReceivedAtMs: number | null;
  pressureState: "healthy" | "warning" | "critical";
  recommendedAction: "none" | "reviewRetention" | "clearOldLogs";
};

export type DeviceLogStorageClearResult = {
  removedFileCount: number;
  removedBytes: number;
};

export type DeviceLogRetentionCandidate = {
  fileName: string;
  bytes: number;
};

export type DeviceLogRetentionPlan = {
  currentBytes: number;
  targetBytes: number;
  removeFileCount: number;
  removeBytes: number;
  candidates: DeviceLogRetentionCandidate[];
};

export type DeviceLogRetentionApplyResult = {
  removedFileCount: number;
  removedBytes: number;
};
