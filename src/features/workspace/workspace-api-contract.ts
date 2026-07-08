import type { BuildConfiguration } from "@/features/build/build-model";
import type {
  CodeAction,
  EditConflict,
  WorkspaceEditPlan,
} from "@/features/code-actions/code-action-model";
import type { DeviceFaultLogFetchResult } from "@/features/device-log/device-fault-log-model";
import type { GitBlameLine, GitCommitTrace, GitTraceUnavailable } from "@/features/git/git-trace-model";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import type { AppSettings } from "@/features/settings/settings-store";
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
  WorkspaceIndexExplainRequest,
  WorkspaceIndexExplainResult,
  WorkspaceIndexFileReadiness,
  WorkspaceIndexHealth,
  WorkspaceIndexLayerReadiness,
  WorkspaceIndexLayerReadinessReport,
  WorkspaceIndexParserFailure,
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryScope,
  WorkspaceIndexTaskStatus,
  WorkspaceIndexTaskStatusWatcher,
  WorkspaceIndexUnresolvedImport,
  WorkspaceSdkIndexSummary,
  WorkspaceTextSearchRequest,
} from "@/features/workspace/workspace-index-api-types";
import type { FileTreeNode } from "@/features/workspace/file-tree-store";
import type { SearchCandidate, WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import type { UsageResult } from "@/features/workspace/usage-search";

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
  WorkspaceIndexTaskStatus,
  WorkspaceIndexTaskStatusWatcher,
  WorkspaceIndexTimelineItem,
  WorkspaceIndexUnresolvedImport,
  WorkspaceSdkIndexSummary,
  WorkspaceTextSearchRequest,
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
  scanSummary: WorkspaceScanSummary;
};

export type WorkspaceIndexRefreshResult = {
  state: WorkspaceIndexState;
  changed: boolean;
  addedPaths: string[];
  removedPaths: string[];
};

export type WorkspaceIndexWatcher = (result: WorkspaceIndexRefreshResult) => void;

export type PathPickOptions = {
  directory?: boolean;
  title: string;
};

export type PathSaveOptions = {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
  title: string;
};

export type ValidationProblem = {
  source: "lint" | "format" | "language" | "build";
  severity: "error" | "warning";
  path: string;
  line: number;
  column: number;
  message: string;
};

export type EnvironmentTool = {
  name: string;
  available: boolean;
  detail: string;
};

export type EnvironmentReport = {
  tools: EnvironmentTool[];
};

export type TerminalRunRequest = {
  runId: string;
  command: string;
  cwd: string | null;
  source: "preset" | "manual";
};

export type TerminalRunResult = {
  runId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  stopped: boolean;
};

export type TerminalSessionStatus = "starting" | "idle" | "running" | "closed" | "error";

export type TerminalSessionSummary = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: TerminalSessionStatus;
};

export type CreateTerminalSessionRequest = {
  cwd: string | null;
};

export type TerminalInputWriteRequest = {
  sessionId: string;
  data: string;
};

export type TerminalResizeRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};

export type LanguageQueryRequest = {
  path: string;
  line: number;
  column: number;
  content?: string;
};

export type LanguageServiceReport = {
  provider: string;
  mode: "semantic" | "fallback" | "unavailable";
  running: boolean;
  hover: boolean;
  definition: boolean;
  completion: boolean;
  documentSymbols: boolean;
  findUsages: boolean;
  detail: string;
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

export type LanguageCompletionItem = {
  label: string;
  detail: string;
  kind: string;
  insertText?: string;
  filterText?: string;
  sortText?: string;
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "fallback";
  documentation?: string;
  replacementRange?: TextRange;
  commitCharacters?: string[];
  definitionTarget?: DefinitionTarget;
  data?: LanguageCompletionItemData;
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
};

export type WorkspaceApi = {
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
  clearWorkspaceIndex?(rootPath: string): Promise<void>;
  rebuildWorkspaceIndex?(rootPath: string): Promise<void>;
  resumeWorkspaceIndexing?(rootPath: string): Promise<void>;
  rebuildWorkspaceSdkIndex?(rootPath: string): Promise<WorkspaceIndexTaskStatus>;
  inspectWorkspaceParserFailures?(rootPath: string, limit: number): Promise<WorkspaceIndexParserFailure[]>;
  inspectWorkspaceUnresolvedImports?(rootPath: string, limit: number): Promise<WorkspaceIndexUnresolvedImport[]>;
  indexWorkspaceSdkSymbols?(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceSdkIndexSummary>;
  submitWorkspaceSdkIndex?(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceIndexTaskStatus>;
  queryWorkspaceQuickOpen?(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceSearchEverywhere?(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceCandidates?(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number, cursor?: number | null): Promise<SearchCandidate[]>;
  queryWorkspaceCandidatesWithReadiness?(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number, cursor?: number | null): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryWorkspaceFileSymbols?(rootPath: string, filePath: string, query: string, limit: number, cursor?: number | null): Promise<SearchCandidate[]>;
  queryWorkspaceFileSymbolsWithReadiness?(rootPath: string, filePath: string, query: string, limit: number, cursor?: number | null): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryDefinitionCandidatesWithReadiness?(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>;
  queryUsagesWithReadiness?(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<UsageResult>>;
  semanticCompleteSymbol?(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<LanguageCompletionItem>>;
  explainWorkspaceIndexQuery?(request: WorkspaceIndexExplainRequest): Promise<WorkspaceIndexExplainResult>;
  updateWorkspaceIndexFiles?(rootPath: string, addedPaths: string[], removedPaths: string[]): Promise<WorkspaceIndexState>;
  scheduleForegroundCompletionIndex?(rootPath: string, changedPaths: string[]): Promise<void>;
  scheduleForegroundNavigationIndex?(rootPath: string, changedPaths: string[]): Promise<void>;
  scheduleVisibleFilesIndex?(rootPath: string, changedPaths: string[]): Promise<void>;
  refreshWorkspaceIndex?(rootPath: string): Promise<WorkspaceIndexState>;
  refreshWorkspaceIndexWithChanges?(rootPath: string): Promise<WorkspaceIndexRefreshResult>;
  watchWorkspaceIndex?(rootPath: string, onChange: WorkspaceIndexWatcher): Promise<() => void>;
  searchWorkspaceText?(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResult>;
  cancelWorkspaceSearch?(rootPath: string, kind: string, generation: number): Promise<void>;
  openWorkspaceInNewWindow?(rootPath: string): Promise<void>;
  getLaunchWorkspacePath?(): Promise<string | null>;
  openDemoWorkspace(): Promise<WorkspaceSnapshot>;
  openFile(path: string): Promise<string>;
  saveFile(path: string, content: string): Promise<void>;
  runValidation(path: string, content: string): Promise<ValidationProblem[]>;
  loadDiff(rootPath: string | null): Promise<string>;
  inspectEnvironment(): Promise<EnvironmentReport>;
  inspectLanguageService?(): Promise<LanguageServiceReport>;
  hoverSymbol?(request: LanguageQueryRequest): Promise<HoverResponse | null>;
  gotoDefinition?(request: LanguageQueryRequest): Promise<DefinitionTarget | null>;
  gotoDefinitionCandidates?(request: LanguageQueryRequest): Promise<DefinitionCandidate[]>;
  completeSymbol?(request: LanguageQueryRequest): Promise<LanguageCompletionItem[]>;
  documentSymbols?(request: LanguageQueryRequest): Promise<DocumentSymbol[]>;
  findUsages?(request: LanguageQueryRequest): Promise<UsageResult[]>;
  listCodeActions?(request: LanguageQueryRequest): Promise<CodeAction[]>;
  resolveCodeAction?(request: CodeActionResolveRequest): Promise<CodeActionResolution>;
  previewWorkspaceEdit?(request: WorkspaceEditPreviewRequest): Promise<WorkspaceEditPreview>;
  applyWorkspaceEdit?(request: ApplyWorkspaceEditRequest): Promise<ApplyWorkspaceEditResult>;
  getFileBlame?(path: string): Promise<GitBlameLine[] | GitTraceUnavailable>;
  getCommitTrace?(path: string, commit: string, line: number): Promise<GitCommitTrace | GitTraceUnavailable>;
  loadSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  loadBuildConfigurations?(rootPath: string): Promise<BuildConfiguration[]>;
  saveBuildConfigurations?(rootPath: string, configurations: BuildConfiguration[]): Promise<void>;
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
