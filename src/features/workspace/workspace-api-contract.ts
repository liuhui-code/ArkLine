import type { BuildConfiguration, BuildEnvironmentResolution, BuildTarget, HarmonyBuildProject } from "@/features/build/build-model";
import type { BuildEnvironmentRequest } from "@/features/build/build-environment-request";
import type { CodeAction, EditConflict, WorkspaceEditPlan } from "@/features/code-actions/code-action-model";
import type { DeviceFaultLogFetchResult } from "@/features/device-log/device-fault-log-model";
import type { LanguageServiceReport, SemanticAvailability } from "@/features/workspace/workspace-language-api-types";
import type { ValidationQueryResult } from "@/features/workspace/workspace-validation-api-types";
export type * from "@/features/workspace/workspace-language-api-types";
export type * from "@/features/workspace/workspace-validation-api-types";
import type {
  WorkspaceTextSearchResult,
  WorkspaceTextSearchStreamEvent,
  WorkspaceTextSearchStreamTerminal,
} from "@/features/search/workspace-text-search";
import type { AppSettings, TerminalSettings } from "@/features/settings/settings-store";
import type {
  CreateTerminalSessionRequest,
  TerminalInputWriteRequest,
  TerminalProfileResolution,
  TerminalResizeRequest,
  TerminalRunRequest,
  TerminalRunResult,
  TerminalSessionSummary,
} from "@/features/workspace/workspace-terminal-api-types";
export type * from "@/features/workspace/workspace-terminal-api-types";
import type {
  DeviceLogDevice,
  DeviceLogQueryRequest,
  DeviceLogQueryResponse,
  DeviceLogQueryWorkerEvent,
  DeviceLogQueryWorkerStats,
  DeviceLogRetentionApplyResult,
  DeviceLogRetentionPlan,
  DeviceLogRuntimeStats,
  DeviceLogStorageClearResult,
  DeviceLogStorageHealth,
  DeviceLogStreamSummary,
  ListDeviceFaultLogsRequest,
  StartDeviceLogStreamRequest,
} from "@/features/workspace/workspace-device-log-api-types";
import type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexEvent,
  WorkspaceIndexEventWatcher,
  WorkspaceIndexExplainRequest,
  WorkspaceIndexExplainResult,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexHealth,
  WorkspaceIndexLayerReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexParserFailure,
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryScope,
  WorkspaceSearchRankingContext,
  WorkspaceIndexTaskStatus,
  WorkspaceIndexTaskStatusWatcher,
  WorkspaceIndexUnresolvedImport,
  WorkspaceSdkIndexSummary,
  WorkspaceTextSearchRequest,
  LanguageQueryBrokerEnvelope,
} from "@/features/workspace/workspace-index-api-types";
import type { FileTreeNode } from "@/features/workspace/file-tree-store";
import type { SearchCandidate, WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import type { UsageResult } from "@/features/workspace/usage-search";
import type { LanguageSignatureHelp } from "@/features/workspace/workspace-signature-help-api";
import type { WorkspaceGitApi } from "@/features/workspace/workspace-git-api";

export type { LanguageSignature, LanguageSignatureHelp, LanguageSignatureHelpParameter } from "@/features/workspace/workspace-signature-help-api";
export type {
  DeviceConnectionStatus,
  DeviceLogDevice,
  DeviceLogQueryRequest,
  DeviceLogQueryResponse,
  DeviceLogQueryRow,
  DeviceLogQueryWorkerEvent,
  DeviceLogQueryWorkerStats,
  DeviceLogRetentionCandidate,
  DeviceLogRetentionApplyResult,
  DeviceLogRetentionPlan,
  DeviceLogRuntimeStats,
  DeviceLogStorageClearResult,
  DeviceLogStorageHealth,
  DeviceLogStreamSummary,
  ListDeviceFaultLogsRequest,
  StartDeviceLogStreamRequest,
} from "@/features/workspace/workspace-device-log-api-types";

export type {
  WorkspaceIndexDiagnostics,
  WorkspaceIndexEvent,
  WorkspaceIndexEventWatcher,
  WorkspaceIndexExplainFact,
  WorkspaceIndexExplainRequest,
  WorkspaceIndexExplainResult,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexHealth,
  WorkspaceIndexLayerReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexParserFailure,
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryScope,
  WorkspaceIndexQueuePressure,
  WorkspaceIndexReadiness,
  WorkspaceIndexReadinessState,
  WorkspaceSearchRankingContext,
  WorkspaceIndexTaskStatus,
  WorkspaceIndexTaskStatusWatcher,
  WorkspaceIndexTimelineItem,
  WorkspaceIndexUnresolvedImport,
  WorkspaceSdkIndexSummary,
  WorkspaceTextSearchRequest,
  LanguageQueryBrokerEnvelope,
} from "@/features/workspace/workspace-index-api-types";
export type WorkspaceSnapshot = {
  rootName: string;
  rootPath: string;
  files: string[];
  scanSummary?: WorkspaceScanSummary;
};

export type WorkspaceScanSummary = {
  scannedFiles: number;
  skippedEntries: number;
  truncated: boolean;
  excludeRules: string[];
};

export type WorkspaceDirectoryEntry = {
  name: string;
  path: string;
  kind: "directory" | "file";
  excluded: boolean;
  hasChildren: boolean;
};

export type WorkspaceViewModel = {
  rootName: string;
  rootPath: string;
  visibleFiles: string[];
  fileTree: FileTreeNode[];
  scanSummary: WorkspaceScanSummary | null;
};

export type WorkspaceIndexRefreshResult = {
  state: WorkspaceIndexState;
  changed: boolean;
  addedPaths: string[];
  removedPaths: string[];
};

export type WorkspaceIndexWatcher = (result: WorkspaceIndexRefreshResult) => void;

export type WorkspaceFileChangeEvent = {
  rootPath: string;
  path: string;
  kind: "modified";
};

export type WorkspaceFileChangeWatcher = (event: WorkspaceFileChangeEvent) => void;

export type PathPickOptions = {
  directory?: boolean;
  title: string;
};

export type PathSaveOptions = {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  title: string;
};

export type EnvironmentTool = {
  name: string;
  available: boolean;
  detail: string;
};

export type EnvironmentReport = {
  tools: EnvironmentTool[];
};

export type LanguageQueryRequest = {
  path: string;
  line: number;
  column: number;
  content?: string;
  documentVersion?: number;
};

export type SemanticDocumentSyncRequest = {
  method: "didOpen" | "didChange";
  path: string;
  content: string;
  documentVersion: number;
  workspaceRoot?: string;
};

export type SemanticDocumentCloseRequest = {
  path: string;
};

export type SemanticDocumentPrepareRequest = {
  path: string;
  documentVersion: number;
};

export type HoverResponse = {
  contents: string;
};

export type DefinitionTarget = {
  path: string;
  line: number;
  column: number;
};

export type TextRange = {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
};

export type DefinitionCandidate = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type RenameImpactItem = {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  name: string;
  kind: string;
  confidence: string;
  preview: string;
};

export type RenameImpactResult = {
  symbolId: string;
  currentName: string;
  declaration: RenameImpactItem | null;
  references: RenameImpactItem[];
};

export type SymbolHierarchyNode = {
  symbolId: string;
  name: string;
  kind: string;
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type CallHierarchyEdge = SymbolHierarchyNode & {
  confidence: string;
};

export type CallHierarchyResult = {
  target: SymbolHierarchyNode;
  incoming: CallHierarchyEdge[];
  outgoing: CallHierarchyEdge[];
};

export type TypeHierarchyResult = {
  target: SymbolHierarchyNode;
  supertypes: SymbolHierarchyNode[];
  subtypes: SymbolHierarchyNode[];
};

export type LanguageCompletionItem = {
  label: string;
  detail: string;
  kind: string;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "type" | "fallback";
  documentation?: string;
  replacementRange?: TextRange;
  commitCharacters?: string[];
  definitionTarget?: DefinitionTarget;
  additionalTextEdits?: CompletionTextEdit[];
  data?: LanguageCompletionItemData;
};

export type CompletionTextEdit = {
  path: string;
  range: TextRange;
  newText: string;
  expectedVersion?: number;
};

export type CompletionImportPreviewEdit = {
  kind: "importPreview";
  targetPath: string;
  applyMode: "explicit";
};

export type LanguageCompletionItemData = {
  symbolId?: string;
  importPath?: string;
  completionEdit?: CompletionImportPreviewEdit;
  [key: string]: unknown;
};

export type DocumentSymbol = {
  name: string;
  kind: string;
  line: number;
  column: number;
};

export type CodeActionResolveRequest = {
  id: string;
  data?: Record<string, unknown>;
};

export type UnsupportedCodeActionResolution = {
  status: "unsupported";
  reason: string;
};

export type CodeActionResolution = WorkspaceEditPlan | UnsupportedCodeActionResolution;

export type RenameSymbolRequest = LanguageQueryRequest & {
  newName: string;
  documentVersion?: number;
};

export type UsageQueryResult = {
  availability: SemanticAvailability;
  items: UsageResult[];
  message?: string;
};

export type RenameSymbolResult = {
  availability: SemanticAvailability;
  resolution?: CodeActionResolution;
  message?: string;
};

export type WorkspaceEditPreviewRequest = {
  workspaceRoot: string;
  plan: WorkspaceEditPlan;
};

export type WorkspaceEditPreview = {
  plan: WorkspaceEditPlan;
  conflicts: EditConflict[];
  affectedFiles: string[];
  summary: string[];
};

export type ApplyWorkspaceEditRequest = {
  workspaceRoot: string;
  plan: WorkspaceEditPlan;
};

export type ApplyWorkspaceEditResult = {
  applied: boolean;
  conflicts: EditConflict[];
  changedFiles: string[];
  undoPlan?: WorkspaceEditPlan;
};

type WorkspaceCoreApi = {
  pickWorkspaceRoot(): Promise<string | null>;
  pickPath?(options: PathPickOptions): Promise<string | null>;
  pickSaveFile?(options: PathSaveOptions): Promise<string | null>;
  openWorkspace(rootPath: string): Promise<WorkspaceSnapshot>;
  listWorkspaceDirectory?(rootPath: string, directoryPath: string): Promise<WorkspaceDirectoryEntry[]>;
  getWorkspaceIndexState?(rootPath: string): Promise<WorkspaceIndexState>;
  inspectWorkspaceIndex?(rootPath: string): Promise<WorkspaceIndexDiagnostics>;
  getWorkspaceIndexHealth?(rootPath: string): Promise<WorkspaceIndexHealth>;
  getWorkspaceIndexFileReadiness?(rootPath: string, filePath: string): Promise<WorkspaceIndexFileReadiness>;
  getWorkspaceIndexLayerReadiness?(rootPath: string, currentFilePath?: string | null): Promise<WorkspaceIndexLayerReadinessReport>;
  getWorkspaceIndexTaskStatuses?(rootPath: string): Promise<WorkspaceIndexTaskStatus[]>;
  watchWorkspaceIndexTaskStatuses?(rootPath: string, onChange: WorkspaceIndexTaskStatusWatcher): Promise<() => void>;
  watchWorkspaceIndexEvents?(rootPath: string, onChange: WorkspaceIndexEventWatcher): Promise<() => void>;
  clearWorkspaceIndex?(rootPath: string): Promise<void>;
  rebuildWorkspaceIndex?(rootPath: string): Promise<void>;
  resumeWorkspaceIndexing?(rootPath: string): Promise<void>;
  rebuildWorkspaceSdkIndex?(rootPath: string): Promise<WorkspaceIndexTaskStatus>;
  inspectWorkspaceParserFailures?(rootPath: string, limit: number): Promise<WorkspaceIndexParserFailure[]>;
  inspectWorkspaceUnresolvedImports?(rootPath: string, limit: number): Promise<WorkspaceIndexUnresolvedImport[]>;
  indexWorkspaceSdkSymbols?(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceSdkIndexSummary>;
  submitWorkspaceSdkIndex?(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceIndexTaskStatus>;
  queryWorkspaceQuickOpen?(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceCandidatesWithReadiness?(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number, cursor?: number | null, context?: WorkspaceSearchRankingContext, generation?: number, deadlineMs?: number): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryWorkspaceFileSymbolsWithReadiness?(rootPath: string, filePath: string, query: string, limit: number, cursor?: number | null): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryDefinitionCandidatesWithReadiness?(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>;
  queryUsagesWithReadiness?(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<UsageResult>>;
  queryRenameImpact?(rootPath: string, request: LanguageQueryRequest): Promise<RenameImpactResult | null>;
  queryCallHierarchy?(rootPath: string, request: LanguageQueryRequest): Promise<CallHierarchyResult | null>;
  queryTypeHierarchy?(rootPath: string, request: LanguageQueryRequest): Promise<TypeHierarchyResult | null>;
  semanticCompleteSymbol?(rootPath: string, request: LanguageQueryRequest, requestGeneration?: number): Promise<WorkspaceIndexQueryEnvelope<LanguageCompletionItem>>;
  queryLanguageDefinition?(rootPath: string, request: LanguageQueryRequest, requestGeneration: number, documentVersion?: number | null): Promise<LanguageQueryBrokerEnvelope<DefinitionCandidate>>;
  queryLanguageCompletion?(rootPath: string, request: LanguageQueryRequest, requestGeneration: number, documentVersion?: number | null): Promise<LanguageQueryBrokerEnvelope<LanguageCompletionItem>>;
  explainWorkspaceIndexQuery?(request: WorkspaceIndexExplainRequest): Promise<WorkspaceIndexExplainResult>;
  updateWorkspaceIndexFiles?(rootPath: string, addedPaths: string[], removedPaths: string[]): Promise<WorkspaceIndexState>;
  scheduleForegroundCompletionIndex?(rootPath: string, changedPaths: string[]): Promise<void>;
  scheduleForegroundNavigationIndex?(rootPath: string, changedPaths: string[]): Promise<void>;
  scheduleVisibleFilesIndex?(rootPath: string, changedPaths: string[]): Promise<void>;
  refreshWorkspaceIndex?(rootPath: string): Promise<WorkspaceIndexState>;
  refreshWorkspaceIndexWithChanges?(rootPath: string): Promise<WorkspaceIndexRefreshResult>;
  watchWorkspaceIndex?(rootPath: string, onChange: WorkspaceIndexWatcher): Promise<() => void>;
  watchWorkspaceFileChanges?(rootPath: string, onChange: WorkspaceFileChangeWatcher): Promise<() => void>;
  searchWorkspaceText?(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResult>;
  streamWorkspaceText?(
    request: WorkspaceTextSearchRequest,
    onEvent: (event: WorkspaceTextSearchStreamEvent) => void,
  ): Promise<WorkspaceTextSearchStreamTerminal>;
  cancelWorkspaceSearch?(rootPath: string, kind: string, generation: number): Promise<void>;
  openWorkspaceInNewWindow?(rootPath: string): Promise<void>;
  getLaunchWorkspacePath?(): Promise<string | null>;
  openDemoWorkspace(): Promise<WorkspaceSnapshot>;
  openFile(path: string, telemetry?: { interactionId?: string }): Promise<string>;
  saveFile(path: string, content: string, expectedContent?: string): Promise<void>;
  syncSemanticDocument?(request: SemanticDocumentSyncRequest): Promise<void>;
  prepareSemanticDocument?(request: SemanticDocumentPrepareRequest): Promise<void>;
  closeSemanticDocument?(request: SemanticDocumentCloseRequest): Promise<void>;
  runValidation(path: string, content: string): Promise<ValidationQueryResult>;
  loadDiff(rootPath: string | null): Promise<string>;
  inspectEnvironment(): Promise<EnvironmentReport>;
  inspectLanguageService?(): Promise<LanguageServiceReport>;
  hoverSymbol?(request: LanguageQueryRequest): Promise<HoverResponse | null>;
  gotoDefinition?(request: LanguageQueryRequest): Promise<DefinitionTarget | null>;
  gotoDefinitionCandidates?(request: LanguageQueryRequest): Promise<DefinitionCandidate[]>;
  completeSymbol?(request: LanguageQueryRequest, requestGeneration?: number, documentVersion?: number): Promise<LanguageCompletionItem[]>;
  resolveCompletion?(request: LanguageQueryRequest, item: LanguageCompletionItem, documentVersion?: number): Promise<LanguageCompletionItem>;
  signatureHelp?(request: LanguageQueryRequest): Promise<LanguageSignatureHelp | null>;
  documentSymbols?(request: LanguageQueryRequest): Promise<DocumentSymbol[]>;
  findUsages?(request: LanguageQueryRequest): Promise<UsageQueryResult>;
  listCodeActions?(request: LanguageQueryRequest): Promise<CodeAction[]>;
  resolveCodeAction?(request: CodeActionResolveRequest): Promise<CodeActionResolution>;
  renameSymbol?(request: RenameSymbolRequest): Promise<RenameSymbolResult>;
  previewWorkspaceEdit?(request: WorkspaceEditPreviewRequest): Promise<WorkspaceEditPreview>;
  applyWorkspaceEdit?(request: ApplyWorkspaceEditRequest): Promise<ApplyWorkspaceEditResult>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  resolveTerminalProfile?(settings: TerminalSettings): Promise<TerminalProfileResolution>;
  loadBuildConfigurations?(rootPath: string): Promise<BuildConfiguration[]>;
  saveBuildConfigurations?(rootPath: string, configurations: BuildConfiguration[]): Promise<void>;
  inspectHarmonyBuildProject?(rootPath: string): Promise<HarmonyBuildProject>;
  findHarmonyBuildArtifacts?(rootPath: string, target: BuildTarget, moduleName: string | null, product: string): Promise<string[]>;
  resolveBuildEnvironment?(request: BuildEnvironmentRequest): Promise<BuildEnvironmentResolution>;
  createTerminalSession(request: CreateTerminalSessionRequest): Promise<TerminalSessionSummary>;
  listTerminalSessions(): Promise<TerminalSessionSummary[]>;
  writeTerminalInput(request: TerminalInputWriteRequest): Promise<void>;
  resizeTerminalSession(request: TerminalResizeRequest): Promise<void>;
  closeTerminalSession(sessionId: string): Promise<void>;
  stopTerminalSession(sessionId: string): Promise<void>;
  runTerminalCommand(request: TerminalRunRequest): Promise<TerminalRunResult>;
  stopTerminalCommand(runId: string): Promise<void>;
  listDeviceLogDevices(): Promise<DeviceLogDevice[]>;
  listDeviceFaultLogs(request: ListDeviceFaultLogsRequest): Promise<DeviceFaultLogFetchResult>;
  startDeviceLogStream(request: StartDeviceLogStreamRequest): Promise<DeviceLogStreamSummary>;
  stopDeviceLogStream(streamId: string): Promise<void>;
  queryDeviceLogs?(request: DeviceLogQueryRequest): Promise<DeviceLogQueryResponse>;
  exportDeviceLogs?(request: DeviceLogQueryRequest): Promise<string>;
  exportDeviceLogsToFile?(request: DeviceLogQueryRequest, path: string): Promise<void>;
  getDeviceLogStats?(streamId: string): Promise<DeviceLogRuntimeStats>;
  getDeviceLogQueryWorkerStats?(): Promise<DeviceLogQueryWorkerStats>;
  getDeviceLogQueryWorkerEvents?(): Promise<DeviceLogQueryWorkerEvent[]>;
  getDeviceLogStorageHealth?(): Promise<DeviceLogStorageHealth>;
  clearDeviceLogStorage?(): Promise<DeviceLogStorageClearResult>;
  planDeviceLogRetention?(targetBytes: number): Promise<DeviceLogRetentionPlan>;
  applyDeviceLogRetention?(targetBytes: number): Promise<DeviceLogRetentionApplyResult>;
};

export type WorkspaceApi = WorkspaceCoreApi & WorkspaceGitApi;
