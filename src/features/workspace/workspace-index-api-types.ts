import type { WorkspaceTextSearchCursor, WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";

export type WorkspaceIndexDiagnostics = {
  rootPath: string;
  status: string;
  schemaVersions: Record<string, number>;
  schemaVersionActions: WorkspaceIndexSchemaVersionAction[];
  fileCount: number;
  symbolCount: number;
  contentLineCount: number;
  fingerprintCount: number;
  stubFileCount: number;
  stubDeclarationCount: number;
  dependencyEdgeCount: number;
  unresolvedImportCount: number;
  parserErrorCount: number;
  staleGenerationCount: number;
  sdkSymbolCount: number;
  discoveryStatus: string | null;
  discoveredFileCount: number;
  discoveryExcludedCount: number;
  discoveryHasMore: boolean;
  dbSizeBytes: number;
  queuePressure: WorkspaceIndexQueuePressure;
  activeSdkPath: string | null;
  activeSdkVersion: string | null;
  lastError: string | null;
  lastExplainStatus: string | null;
  repairActions: string[];
  parserFailures: WorkspaceIndexParserFailure[];
  unresolvedImports: WorkspaceIndexUnresolvedImport[];
  recentEvents: WorkspaceIndexEvent[];
  timeline: WorkspaceIndexTimelineItem[];
};

export type WorkspaceIndexSchemaVersionAction = {
  domain: string;
  expectedVersion: number;
  persistedVersion: number | null;
  status: "compatible" | "missing-version" | "needs-rebuild" | string;
};

export type WorkspaceIndexEvent = {
  eventId: string;
  rootPath: string;
  scope: string;
  kind: string;
  phase: string;
  severity: "info" | "warning" | "error" | string;
  message: string;
  taskId: string | null;
  generation: number | null;
  payloadJson: string;
  createdAt: number;
};

export type WorkspaceIndexTimelineItem = {
  scope: string;
  kind: string;
  phase: string;
  title: string;
  severity: "info" | "warning" | "error" | string;
  message: string;
  taskId: string | null;
  generation: number | null;
  occurredAt: number;
  durationMs: number | null;
};

export type WorkspaceIndexQueuePressure = {
  rootPath: string;
  pendingTaskCount: number;
  workspacePendingTaskCount: number;
  highestPriority: string | null;
  highestPriorityTaskKind: string | null;
};

export type WorkspaceIndexHealth = {
  rootPath: string;
  status: string;
  fileCount: number;
  symbolCount: number;
  referenceCount: number;
  sdkApiCount: number;
  discoveryStatus: string | null;
  discoveredFileCount: number;
  unresolvedImportCount: number;
  parserFailureCount: number;
  queuePressure: WorkspaceIndexQueuePressure;
  repairActions: string[];
};

export type WorkspaceIndexFileReadiness = {
  rootPath: string;
  path: string;
  fileName: string;
  discoveryIndex?: "ready" | "missing" | string;
  fileIndex: "ready" | "missing" | string;
  contentIndex: "ready" | "missing" | string;
  symbolIndex: "ready" | "missing" | string;
  parserStatus: "ready" | "failed" | "unknown" | string;
  parserError: string | null;
  indexedGeneration: number | null;
  definitionAvailable: boolean;
  completionAvailable: boolean;
  usagesAvailable: boolean;
  searchAvailable: boolean;
  reason: string;
};

export type WorkspaceIndexLayerStatus = "ready" | "partial" | "stale" | "failed" | "missing" | string;

export type WorkspaceIndexLayerReadiness = {
  layer: string;
  workspaceStatus: WorkspaceIndexLayerStatus;
  currentFileStatus: WorkspaceIndexLayerStatus | null;
  indexedCount: number;
  failedCount: number;
  staleCount: number;
  reason: string | null;
  recommendedAction: string | null;
};

export type WorkspaceIndexLayerReadinessReport = {
  rootPath: string;
  currentFilePath: string | null;
  layers: WorkspaceIndexLayerReadiness[];
};

export type WorkspaceIndexParserFailure = {
  path: string;
  message: string;
  line: number;
  column: number;
};

export type WorkspaceIndexUnresolvedImport = {
  fromPath: string;
  sourceModule: string;
  line: number;
  column: number;
};

export type WorkspaceSdkIndexSummary = {
  symbolCount: number;
};

export type WorkspaceIndexTaskStatus = {
  taskId: string;
  rootPath: string;
  kind: string;
  status: "queued" | "running" | "ready" | "partial" | "stale" | "failed" | "cancelled" | "superseded" | "skipped" | string;
  reason: string;
  generation: number;
  progressCurrent: number;
  progressTotal: number;
  targetPaths?: string[];
  targetPathCount?: number;
  startedAt?: number;
  lastHeartbeatAt?: number;
  stalled?: boolean;
  finishedAt?: number;
  symbolCount?: number;
  message?: string;
  error?: string;
};

export type WorkspaceIndexQueryScope = "all" | "files" | "classes" | "symbols" | "api" | "text";

export type WorkspaceTextSearchRequest = {
  rootPath: string;
  query: string;
  generation?: number;
  cursor?: WorkspaceTextSearchCursor | null;
  options: WorkspaceTextSearchOptions;
  limit: number;
  contextLines: number;
};

export type WorkspaceIndexTaskStatusWatcher = (status: WorkspaceIndexTaskStatus) => void;

export type WorkspaceIndexReadinessState = "ready" | "partial" | "stale" | "blocked" | "missing";

export type WorkspaceIndexReadiness = {
  rootPath: string;
  requestedGeneration: number;
  servedGeneration: number | null;
  state: WorkspaceIndexReadinessState;
  reason?: string;
  retryable: boolean;
};

export type WorkspaceIndexQueryEnvelope<T> = {
  items: T[];
  readiness: WorkspaceIndexReadiness;
  explain?: string[];
  nextCursor?: number | null;
};

export type WorkspaceIndexExplainRequest = {
  rootPath: string;
  kind: "search" | "definition" | "symbol" | "completion" | "api";
  query: string;
  path?: string | null;
  line?: number | null;
  column?: number | null;
};

export type WorkspaceIndexExplainFact = {
  category: string;
  evidence: string;
};

export type WorkspaceIndexExplainResult = {
  status: "found" | "notIndexed" | "excluded" | "stale" | "partial" | "sdkNotReady" | "parserFailed" | "unsupported";
  message: string;
  facts: WorkspaceIndexExplainFact[];
  recommendedAction?: "wait" | "rebuildIndex" | "configureSdk" | "openFile" | "reportBug" | null;
};
