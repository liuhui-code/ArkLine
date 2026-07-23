import type { WorkspaceTextSearchCursor, WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";

export type WorkspaceIndexDiagnostics = {
  rootPath: string;
  status: string;
  schemaVersions: Record<string, number>;
  schemaVersionActions: WorkspaceIndexSchemaVersionAction[];
  freshnessLayers: WorkspaceIndexFreshnessLayerSummary[];
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
  walSizeBytes?: number;
  freelistBytes?: number;
  compactionStatus?: string;
  storeRevision?: number;
  storeGeneration?: number;
  activeStoreReaderCount?: number;
  sharedSdkArtifactCount?: number;
  sharedSdkReadyArtifactCount?: number;
  sharedSdkBuildingArtifactCount?: number;
  sharedSdkFailedArtifactCount?: number;
  sharedSdkReferenceCount?: number;
  sharedSdkDbSizeBytes?: number;
  sharedSdkWalSizeBytes?: number;
  sharedSdkFreelistBytes?: number;
  sharedSdkStoreRevision?: number;
  sharedSdkStoreGeneration?: number;
  sharedSdkActiveReaderCount?: number;
  sharedSdkLastMaintenanceAt?: number | null;
  sharedSdkLastDeletedArtifactCount?: number;
  writerMetrics?: WorkspaceIndexWriterMetrics;
  queuePressure: WorkspaceIndexQueuePressure;
  activeSdkPath: string | null;
  activeSdkVersion: string | null;
  lastError: string | null;
  lastExplainStatus: string | null;
  retryBackoffCount: number;
  latestRetryBackoff: string | null;
  repairActions: string[];
  parserFailures: WorkspaceIndexParserFailure[];
  unresolvedImports: WorkspaceIndexUnresolvedImport[];
  recentEvents: WorkspaceIndexEvent[];
  timeline: WorkspaceIndexTimelineItem[];
  indexerHost?: WorkspaceIndexerHostSnapshot;
};

export type WorkspaceIndexWriterMetrics = {
  sampleCount: number;
  activeWriterCount: number;
  queuedWriterCount: number;
  failureCount: number;
  recoveryWorkspaceCount?: number;
  orphanArtifactScannedCount?: number;
  orphanArtifactRemovedCount?: number;
  orphanArtifactRetainedCount?: number;
  recoveryFailureCount?: number;
  sdkPublicationCount?: number;
  sdkPublicationMaxUs?: number;
  maintenancePublicationCount?: number;
  maintenancePublicationMaxUs?: number;
  maintenanceOptimizeCount?: number;
  maintenanceCheckpointCount?: number;
  maintenanceIncrementalVacuumCount?: number;
  maintenanceCopySwapCount?: number;
  maintenanceCopySwapDeferredCount?: number;
  waitP50Us: number;
  waitP95Us: number;
  waitP99Us: number;
  waitMaxUs: number;
  holdP50Us: number;
  holdP95Us: number;
  holdP99Us: number;
  holdMaxUs: number;
  lastWaitUs: number;
  lastHoldUs: number;
};

export type WorkspaceIndexPublicationProfile = {
  rootPath: string;
  totalDurationUs: number;
  stages: WorkspaceIndexPublicationStage[];
};

export type WorkspaceIndexPublicationStage = {
  name: string;
  durationUs: number;
};

export type WorkspaceIndexerHostSnapshot = {
  enabled: boolean;
  status: string;
  processId: number | null;
  discoveryProcessId: number | null;
  contentProcessId: number | null;
  stubProcessId: number | null;
  discoveryWriterMetrics?: WorkspaceIndexWriterMetrics | null;
  contentWriterMetrics?: WorkspaceIndexWriterMetrics | null;
  stubWriterMetrics?: WorkspaceIndexWriterMetrics | null;
  publicationWriterMetrics?: WorkspaceIndexWriterMetrics | null;
  slowestDiscoveryPublication?: WorkspaceIndexPublicationProfile | null;
  slowestContentPublication?: WorkspaceIndexPublicationProfile | null;
  slowestStubPublication?: WorkspaceIndexPublicationProfile | null;
  completedDiscoveryChunks: number;
  completedContentRefreshChunks: number;
  cancelledContentRefreshChunks: number;
  completedStubRefreshChunks: number;
  cancelledStubRefreshChunks: number;
  fallbackCount: number;
  restartCount: number;
  consecutiveFailureCount: number;
  backoffRemainingMs: number | null;
  lastError: string | null;
};

export type WorkspaceIndexSchemaVersionAction = {
  domain: string;
  expectedVersion: number;
  persistedVersion: number | null;
  status: "compatible" | "missing-version" | "needs-rebuild" | string;
};

export type WorkspaceIndexFreshnessLayerSummary = {
  layer: string;
  readyCount: number;
  staleCount: number;
  missingCount: number;
  expectedVersion: number;
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

export type WorkspaceIndexEventWatcher = (event: WorkspaceIndexEvent) => void;

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
  retryBackoffCount: number;
  latestRetryBackoff: string | null;
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
  semanticLayers: WorkspaceSemanticLayerReadiness[];
  definitionAvailable: boolean;
  completionAvailable: boolean;
  usagesAvailable: boolean;
  searchAvailable: boolean;
  reason: string;
};

export type WorkspaceSemanticLayerReadiness = {
  layer: "syntax" | "editorSyntax" | "projectModel" | "definitions" | "editorDefinitions" | "types" | "editorTypes" | "references" | string;
  status: "ready" | "partial" | "stale" | "failed" | "building" | "missing" | string;
  sourceGeneration: number | null;
  dependencyGeneration: number | null;
  producerVersion: number | null;
  resultCount: number;
  error: string | null;
  updatedAt: number | null;
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

export type WorkspaceSearchRankingContext = {
  activePath?: string | null;
  recentPaths?: string[];
  openedPaths?: string[];
};

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
  kind: "search" | "definition" | "symbol" | "completion" | "usage" | "usages" | "api";
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
  status: "found" | "notFound" | "notIndexed" | "excluded" | "stale" | "partial" | "sdkNotReady" | "parserFailed" | "semanticFailed" | "unsupported";
  message: string;
  facts: WorkspaceIndexExplainFact[];
  recommendedAction?: "wait" | "rebuildIndex" | "indexCurrentFile" | "configureSdk" | "openFile" | "reportBug" | null;
};
