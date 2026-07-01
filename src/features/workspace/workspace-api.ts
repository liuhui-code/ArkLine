import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  CodeAction,
  EditConflict,
  WorkspaceEditPlan,
} from "@/features/code-actions/code-action-model";
import { createFileTreeNodes, type FileTreeNode } from "@/features/workspace/file-tree-store";
import type { SearchCandidate, WorkspaceIndexState } from "@/features/workspace/workspace-index-store";
import type { GitBlameLine, GitCommitTrace, GitTraceUnavailable } from "@/features/git/git-trace-model";
import { defaultSettings, type AppSettings } from "@/features/settings/settings-store";
import {
  searchWorkspaceText as searchWorkspaceTextInMemory,
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import {
  collectFallbackCompletions,
  collectFallbackDocumentSymbols,
} from "@/features/workspace/fallback-symbols";
import type { UsageResult } from "@/features/workspace/usage-search";
import {
  createWorkspaceStore,
  DEFAULT_WORKSPACE_EXCLUDES,
  getPathBasename,
  normalizePath,
  splitPathSegments,
  type WorkspaceOpenInput
} from "@/features/workspace/workspace-store";
import type { DeviceFaultLogFetchResult } from "@/features/device-log/device-fault-log-model";

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

export type WorkspaceIndexDiagnostics = {
  rootPath: string;
  status: string;
  schemaVersions: Record<string, number>;
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
  activeSdkPath: string | null;
  activeSdkVersion: string | null;
  lastError: string | null;
  lastExplainStatus: string | null;
};

export type WorkspaceSdkIndexSummary = {
  symbolCount: number;
};

export type WorkspaceIndexTaskStatus = {
  taskId: string;
  rootPath: string;
  kind: string;
  status: "queued" | "running" | "ready" | "partial" | "stale" | "failed" | string;
  reason: string;
  generation: number;
  progressCurrent: number;
  progressTotal: number;
  startedAt?: number;
  finishedAt?: number;
  symbolCount?: number;
  message?: string;
  error?: string;
};

export type WorkspaceIndexQueryScope = "all" | "files" | "classes" | "symbols" | "api";

export type WorkspaceTextSearchRequest = {
  rootPath: string;
  query: string;
  options: WorkspaceTextSearchOptions;
  limit: number;
  contextLines: number;
};

export type WorkspaceIndexWatcher = (result: WorkspaceIndexRefreshResult) => void;
export type WorkspaceIndexTaskStatusWatcher = (status: WorkspaceIndexTaskStatus) => void;

export type WorkspaceLaunchContext = {
  rootPath: string | null;
};

export type PathPickOptions = {
  directory?: boolean;
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
  data?: Record<string, unknown>;
};

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
  openWorkspace(rootPath: string): Promise<WorkspaceSnapshot>;
  listWorkspaceDirectory?(rootPath: string, directoryPath: string): Promise<WorkspaceDirectoryEntry[]>;
  getWorkspaceIndexState?(rootPath: string): Promise<WorkspaceIndexState>;
  inspectWorkspaceIndex?(rootPath: string): Promise<WorkspaceIndexDiagnostics>;
  getWorkspaceIndexTaskStatuses?(rootPath: string): Promise<WorkspaceIndexTaskStatus[]>;
  watchWorkspaceIndexTaskStatuses?(rootPath: string, onChange: WorkspaceIndexTaskStatusWatcher): Promise<() => void>;
  clearWorkspaceIndex?(rootPath: string): Promise<void>;
  rebuildWorkspaceIndex?(rootPath: string): Promise<void>;
  indexWorkspaceSdkSymbols?(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceSdkIndexSummary>;
  submitWorkspaceSdkIndex?(rootPath: string, sdkPath: string, sdkVersion: string): Promise<WorkspaceIndexTaskStatus>;
  queryWorkspaceQuickOpen?(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceSearchEverywhere?(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceCandidates?(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceCandidatesWithReadiness?(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryWorkspaceFileSymbols?(rootPath: string, filePath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceFileSymbolsWithReadiness?(rootPath: string, filePath: string, query: string, limit: number): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryDefinitionCandidatesWithReadiness?(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>;
  explainWorkspaceIndexQuery?(request: WorkspaceIndexExplainRequest): Promise<WorkspaceIndexExplainResult>;
  updateWorkspaceIndexFiles?(rootPath: string, addedPaths: string[], removedPaths: string[]): Promise<WorkspaceIndexState>;
  refreshWorkspaceIndex?(rootPath: string): Promise<WorkspaceIndexState>;
  refreshWorkspaceIndexWithChanges?(rootPath: string): Promise<WorkspaceIndexRefreshResult>;
  watchWorkspaceIndex?(rootPath: string, onChange: WorkspaceIndexWatcher): Promise<() => void>;
  searchWorkspaceText?(request: WorkspaceTextSearchRequest): Promise<WorkspaceTextSearchResult>;
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
};

const demoWorkspace: WorkspaceSnapshot = {
  rootName: "DemoWorkspace",
  rootPath: "C:/samples/DemoWorkspace",
  files: [
    "C:/samples/DemoWorkspace/src/main.ets",
    "C:/samples/DemoWorkspace/AppScope/app.json5",
    "C:/samples/DemoWorkspace/node_modules/react/index.js"
  ],
  scanSummary: {
    scannedFiles: 3,
    skippedEntries: 1,
    truncated: false,
    excludeRules: [...DEFAULT_WORKSPACE_EXCLUDES],
  },
};

function hasTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function joinPath(base: string, ...segments: string[]) {
  const separator = base.includes("\\") ? "\\" : "/";
  return [base.replace(/[\\/]+$/g, ""), ...segments].join(separator);
}

function isDemoWorkspacePath(path: string) {
  return normalizePath(path).startsWith(normalizePath(demoWorkspace.rootPath));
}

async function loadWorkspaceSnapshot(rootPath: string) {
  if (hasTauriRuntime()) {
    return invoke<WorkspaceSnapshot>("open_workspace", { rootPath });
  }

  const normalized = normalizePath(rootPath);
  if (normalized === normalizePath(demoWorkspace.rootPath)) {
    return demoWorkspace;
  }

  const rootName = getPathBasename(normalized) || "Workspace";
  return {
    rootName,
    rootPath: normalized,
    files: [
      joinPath(normalized, "AppScope", "app.json5"),
      joinPath(normalized, "src", "main.ets"),
      joinPath(normalized, "src", "pages", "Index.ets"),
    ],
  };
}

function joinWorkspacePath(base: string, child: string) {
  const normalizedBase = normalizePath(base).replace(/[\\/]+$/g, "");
  const separator = normalizedBase.includes("\\") ? "\\" : "/";
  return `${normalizedBase}${separator}${child}`;
}

function pathHasExcludedSegment(path: string) {
  const segments = splitPathSegments(path);
  return DEFAULT_WORKSPACE_EXCLUDES.some((segment) => segments.includes(segment));
}

function listDirectoryFromSnapshot(snapshot: WorkspaceSnapshot, directoryPath: string): WorkspaceDirectoryEntry[] {
  const normalizedDirectory = normalizePath(directoryPath);
  const directorySegments = splitPathSegments(normalizedDirectory);
  const entries = new Map<string, WorkspaceDirectoryEntry>();

  for (const file of snapshot.files) {
    const normalizedFile = normalizePath(file);
    const fileSegments = splitPathSegments(normalizedFile);
    const isDescendant = directorySegments.every((segment, index) => fileSegments[index] === segment)
      && fileSegments.length > directorySegments.length;

    if (!isDescendant) {
      continue;
    }

    const childName = fileSegments[directorySegments.length];
    if (!childName) {
      continue;
    }

    const childPath = joinWorkspacePath(normalizedDirectory, childName);
    const remainingSegments = fileSegments.slice(directorySegments.length + 1);
    const isDirectory = remainingSegments.length > 0;
    const excluded = pathHasExcludedSegment(childPath);
    const existing = entries.get(childPath);

    entries.set(childPath, {
      name: childName,
      path: childPath,
      kind: isDirectory ? "directory" : "file",
      excluded,
      hasChildren: Boolean((existing?.hasChildren ?? false) || (isDirectory && !excluded && remainingSegments.length > 0)),
    });
  }

  return [...entries.values()].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === "directory" ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

async function loadMockDocumentContent(path: string) {
  const normalized = normalizePath(path);

  if (normalized.endsWith("main.ets")) {
    return "@Entry\n@Component\nstruct Index {}";
  }

  if (normalized.endsWith("app.json5")) {
    return "{\n  \"app\": {\n    \"bundleName\": \"com.demo.app\"\n  }\n}";
  }

  return "";
}

function emptyIndexQueryEnvelope<T>(rootPath: string): WorkspaceIndexQueryEnvelope<T> {
  return {
    items: [],
    readiness: {
      rootPath,
      requestedGeneration: 0,
      servedGeneration: null,
      state: "missing",
      reason: "No indexed generation is available",
      retryable: true,
    },
  };
}

export const defaultWorkspaceApi: WorkspaceApi = {
  async pickWorkspaceRoot() {
    if (!hasTauriRuntime()) {
      return null;
    }

    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open ArkTS Project",
    });

    return typeof selected === "string" ? normalizePath(selected) : null;
  },
  async pickPath(options) {
    if (!hasTauriRuntime()) {
      return null;
    }

    const selected = await open({
      directory: options.directory ?? false,
      multiple: false,
      title: options.title,
    });

    return typeof selected === "string" ? normalizePath(selected) : null;
  },
  async openWorkspace(rootPath) {
    return loadWorkspaceSnapshot(rootPath);
  },
  async listWorkspaceDirectory(rootPath, directoryPath) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceDirectoryEntry[]>("list_workspace_directory", { rootPath, directoryPath });
    }

    const snapshot = await loadWorkspaceSnapshot(rootPath);
    return listDirectoryFromSnapshot(snapshot, directoryPath);
  },
  async getWorkspaceIndexState(rootPath) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexState>("get_workspace_index_state", { rootPath });
    }

    void rootPath;
    return {
      status: "empty",
      rootPath: null,
      filePaths: [],
      symbols: [],
      indexedAt: null,
      partialReason: null,
    };
  },
  async inspectWorkspaceIndex(rootPath) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexDiagnostics>("inspect_workspace_index", { rootPath });
    }

    return {
      rootPath,
      status: "empty",
      schemaVersions: {},
      fileCount: 0,
      symbolCount: 0,
      contentLineCount: 0,
      fingerprintCount: 0,
      stubFileCount: 0,
      stubDeclarationCount: 0,
      dependencyEdgeCount: 0,
      unresolvedImportCount: 0,
      parserErrorCount: 0,
      staleGenerationCount: 0,
      sdkSymbolCount: 0,
      activeSdkPath: null,
      activeSdkVersion: null,
      lastError: null,
      lastExplainStatus: null,
    };
  },
  async getWorkspaceIndexTaskStatuses(rootPath) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexTaskStatus[]>("get_workspace_index_task_statuses", { rootPath });
    }

    void rootPath;
    return [];
  },
  async watchWorkspaceIndexTaskStatuses(rootPath, onChange) {
    if (!hasTauriRuntime()) {
      return () => undefined;
    }

    const unlisten = await listen<WorkspaceIndexTaskStatus>("workspace-index-task-updated", (event) => {
      if (normalizePath(event.payload.rootPath) !== normalizePath(rootPath)) {
        return;
      }

      onChange(event.payload);
    });

    return () => {
      unlisten();
    };
  },
  async clearWorkspaceIndex(rootPath) {
    if (hasTauriRuntime()) {
      await invoke("clear_workspace_index", { rootPath });
      return;
    }

    void rootPath;
  },
  async rebuildWorkspaceIndex(rootPath) {
    if (hasTauriRuntime()) {
      await invoke("rebuild_workspace_index", { rootPath });
      return;
    }

    void rootPath;
  },
  async indexWorkspaceSdkSymbols(rootPath, sdkPath, sdkVersion) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceSdkIndexSummary>("index_workspace_sdk_symbols", { rootPath, sdkPath, sdkVersion });
    }

    void rootPath;
    void sdkPath;
    void sdkVersion;
    return { symbolCount: 0 };
  },
  async submitWorkspaceSdkIndex(rootPath, sdkPath, sdkVersion) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexTaskStatus>("submit_workspace_sdk_index", { rootPath, sdkPath, sdkVersion });
    }

    void rootPath;
    void sdkPath;
    void sdkVersion;
    return {
      taskId: "local:sdk",
      rootPath: "",
      kind: "sdk",
      status: "ready",
      reason: "local-fallback",
      generation: 0,
      progressCurrent: 1,
      progressTotal: 1,
    };
  },
  async queryWorkspaceQuickOpen(rootPath, query, limit) {
    if (hasTauriRuntime()) {
      return invoke<SearchCandidate[]>("query_workspace_quick_open", { rootPath, query, limit });
    }

    void rootPath;
    void query;
    void limit;
    return [];
  },
  async queryWorkspaceSearchEverywhere(rootPath, query, limit) {
    if (hasTauriRuntime()) {
      return invoke<SearchCandidate[]>("query_workspace_search_everywhere", { rootPath, query, limit });
    }

    void rootPath;
    void query;
    void limit;
    return [];
  },
  async queryWorkspaceCandidates(rootPath, query, scope, limit) {
    if (hasTauriRuntime()) {
      return invoke<SearchCandidate[]>("query_workspace_candidates", { rootPath, query, scope, limit });
    }

    void rootPath;
    void query;
    void scope;
    void limit;
    return [];
  },
  async queryWorkspaceCandidatesWithReadiness(rootPath, query, scope, limit) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexQueryEnvelope<SearchCandidate>>("query_workspace_candidates_with_readiness", { rootPath, query, scope, limit });
    }

    void query;
    void scope;
    void limit;
    return emptyIndexQueryEnvelope(rootPath);
  },
  async queryWorkspaceFileSymbols(rootPath, filePath, query, limit) {
    if (hasTauriRuntime()) {
      return invoke<SearchCandidate[]>("query_workspace_file_symbols", { rootPath, filePath, query, limit });
    }

    void rootPath;
    void filePath;
    void query;
    void limit;
    return [];
  },
  async queryWorkspaceFileSymbolsWithReadiness(rootPath, filePath, query, limit) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexQueryEnvelope<SearchCandidate>>("query_workspace_file_symbols_with_readiness", { rootPath, filePath, query, limit });
    }

    void filePath;
    void query;
    void limit;
    return emptyIndexQueryEnvelope(rootPath);
  },
  async queryDefinitionCandidatesWithReadiness(rootPath, request) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>("query_definition_candidates_with_readiness", { rootPath, request });
    }

    void request;
    return emptyIndexQueryEnvelope(rootPath);
  },
  async explainWorkspaceIndexQuery(request) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexExplainResult>("explain_workspace_index_query", { request });
    }

    return {
      status: "unsupported",
      message: "Index explain is unavailable outside the desktop runtime",
      facts: [{ category: "runtime", evidence: request.rootPath }],
      recommendedAction: "reportBug",
    };
  },
  async updateWorkspaceIndexFiles(rootPath, addedPaths, removedPaths) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexState>("update_workspace_index_files", { rootPath, addedPaths, removedPaths });
    }

    void rootPath;
    void addedPaths;
    void removedPaths;
    return {
      status: "empty",
      rootPath: null,
      filePaths: [],
      symbols: [],
      indexedAt: null,
      partialReason: null,
    };
  },
  async refreshWorkspaceIndex(rootPath) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexState>("refresh_workspace_index", { rootPath });
    }

    void rootPath;
    return {
      status: "empty",
      rootPath: null,
      filePaths: [],
      symbols: [],
      indexedAt: null,
      partialReason: null,
    };
  },
  async refreshWorkspaceIndexWithChanges(rootPath) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceIndexRefreshResult>("refresh_workspace_index_with_changes", { rootPath });
    }

    void rootPath;
    return {
      state: {
        status: "empty",
        rootPath: null,
        filePaths: [],
        symbols: [],
        indexedAt: null,
        partialReason: null,
      },
      changed: false,
      addedPaths: [],
      removedPaths: [],
    };
  },
  async watchWorkspaceIndex(rootPath, onChange) {
    if (!hasTauriRuntime()) {
      return () => undefined;
    }

    const unlisten = await listen<WorkspaceIndexRefreshResult>("workspace-index-changed", (event) => {
      const eventRootPath = event.payload.state.rootPath;
      if (eventRootPath && normalizePath(eventRootPath) !== normalizePath(rootPath)) {
        return;
      }

      onChange(event.payload);
    });

    try {
      await invoke("watch_workspace_index", { rootPath });
    } catch (error) {
      unlisten();
      throw error;
    }

    return () => {
      unlisten();
      void invoke("unwatch_workspace_index", { rootPath });
    };
  },
  async searchWorkspaceText(request) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceTextSearchResult>("search_workspace_text", { request });
    }

    const snapshot = await loadWorkspaceSnapshot(request.rootPath);
    return searchWorkspaceTextInMemory({
      query: request.query,
      rootPath: request.rootPath,
      paths: snapshot.files,
      options: request.options,
      limit: request.limit,
      contextLines: request.contextLines,
      readFile: loadMockDocumentContent,
    });
  },
  async openWorkspaceInNewWindow(rootPath) {
    if (hasTauriRuntime()) {
      await invoke("open_workspace_in_new_window", { rootPath });
      return;
    }

    void rootPath;
  },
  async getLaunchWorkspacePath() {
    if (hasTauriRuntime()) {
      return invoke<string | null>("get_launch_workspace_path");
    }

    return null;
  },
  async openDemoWorkspace() {
    return loadWorkspaceSnapshot(demoWorkspace.rootPath);
  },
  async openFile(path) {
    if (hasTauriRuntime()) {
      return invoke<string>("open_text_document", { path });
    }

    return loadMockDocumentContent(path);
  },
  async saveFile(path, content) {
    if (hasTauriRuntime()) {
      await invoke("save_text_document", { path, content });
      return;
    }

    void path;
    void content;
  },
  async runValidation(path, content) {
    if (hasTauriRuntime()) {
      return invoke<ValidationProblem[]>("validate_text_document", { path, content });
    }

    const diagnostics: ValidationProblem[] = [];
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      if (line.includes("\t")) {
        diagnostics.push({
          source: "format",
          severity: "warning",
          path,
          line: index + 1,
          column: line.indexOf("\t") + 1,
          message: "Replace tabs with spaces",
        });
      }

      if (line.trimStart().startsWith("console.log(")) {
        diagnostics.push({
          source: "lint",
          severity: "warning",
          path,
          line: index + 1,
          column: line.indexOf("console.log(") + 1,
          message: "Remove console.log before committing",
        });
      }
    });

    if (!content.endsWith("\n")) {
      diagnostics.push({
        source: "format",
        severity: "warning",
        path,
        line: lines.length,
        column: lines.at(-1)?.length ?? 1,
        message: "File should end with a newline",
      });
    }

    return diagnostics;
  },
  async loadDiff(rootPath) {
    if (hasTauriRuntime()) {
      return invoke<string>("load_workspace_diff", { rootPath });
    }

    void rootPath;
    return `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,2 +1,3 @@
 @Entry
-struct Index {}
+struct Index {
+}`;
  },
  async inspectEnvironment() {
    if (hasTauriRuntime()) {
      return invoke<EnvironmentReport>("inspect_environment");
    }

    return {
      tools: [
        { name: "git", available: true, detail: "git version 2.x" },
        { name: "rg", available: false, detail: "Bundled ripgrep not configured yet" },
        { name: "lintCommand", available: false, detail: "arklint: not configured on this machine" },
        { name: "formatCommand", available: false, detail: "arkfmt: not configured on this machine" },
        { name: "arktsLanguageServer", available: false, detail: "Not bundled yet" },
        { name: "webview2", available: true, detail: "Installer enforces minimum version on Windows" },
      ],
    };
  },
  async inspectLanguageService() {
    if (hasTauriRuntime()) {
      return invoke<LanguageServiceReport>("inspect_language_service");
    }

    return {
      provider: "mock-fallback",
      mode: "fallback",
      running: true,
      hover: true,
      definition: true,
      completion: true,
      documentSymbols: true,
      findUsages: true,
      detail: "Mock fallback ArkTS language service for demo and integration-shell wiring",
    };
  },
  async hoverSymbol(request) {
    if (hasTauriRuntime()) {
      return invoke<HoverResponse | null>("hover_symbol", { request });
    }

    if (!isDemoWorkspacePath(request.path)) {
      return null;
    }

    return {
      contents: request.line <= 2
        ? "@Entry decorates the HarmonyOS application entry component."
        : "Index is the root component in this demo ArkTS file.",
    };
  },
  async gotoDefinition(request) {
    if (hasTauriRuntime()) {
      return invoke<DefinitionTarget | null>("goto_definition", { request });
    }

    if (!isDemoWorkspacePath(request.path)) {
      return null;
    }

    return {
      path: normalizePath(request.path),
      line: request.line <= 2 ? 1 : 3,
      column: 1,
    };
  },
  async gotoDefinitionCandidates(request) {
    if (hasTauriRuntime()) {
      return invoke<DefinitionCandidate[]>("goto_definition_candidates", { request });
    }

    return [];
  },
  async completeSymbol(request) {
    if (hasTauriRuntime()) {
      return invoke<LanguageCompletionItem[]>("complete_symbol", { request });
    }

    if (!isDemoWorkspacePath(request.path)) {
      return [];
    }

    const content = await loadMockDocumentContent(request.path);
    return collectFallbackCompletions(content);
  },
  async documentSymbols(request) {
    if (hasTauriRuntime()) {
      return invoke<DocumentSymbol[]>("document_symbols", { request });
    }

    if (!isDemoWorkspacePath(request.path)) {
      return [];
    }

    const content = await loadMockDocumentContent(request.path);
    return collectFallbackDocumentSymbols(content);
  },
  async findUsages(request) {
    if (hasTauriRuntime()) {
      return invoke<UsageResult[]>("find_usages", { request });
    }

    if (!isDemoWorkspacePath(request.path)) {
      return [];
    }

    return [
      {
        path: normalizePath(request.path),
        line: 1,
        column: 1,
        preview: "@Entry",
      },
      {
        path: normalizePath(request.path),
        line: 3,
        column: 8,
        preview: "struct Index {}",
      },
    ];
  },
  async listCodeActions(request) {
    if (hasTauriRuntime()) {
      return invoke<CodeAction[]>("list_code_actions", { request });
    }

    if (!isDemoWorkspacePath(request.path) || !request.path.toLowerCase().endsWith(".ets")) {
      return [];
    }

    return [
      {
        id: "arkts.generate.page",
        title: "Generate ArkTS Page",
        kind: "generate",
        provider: "template",
        safety: "needsPreview",
        data: { template: "arkts-page" },
      },
      {
        id: "arkts.generate.component",
        title: "Generate ArkTS Component",
        kind: "generate",
        provider: "template",
        safety: "needsPreview",
        data: { template: "arkts-component" },
      },
      {
        id: "workspace.renameFile",
        title: "Rename File",
        kind: "source",
        provider: "workspace",
        safety: "needsPreview",
        data: { targetPath: normalizePath(request.path) },
      },
    ];
  },
  async resolveCodeAction(request) {
    if (hasTauriRuntime()) {
      return invoke<CodeActionResolution>("resolve_code_action", { request });
    }

    return {
      status: "unsupported",
      reason: `Resolving code action '${request.id}' is not implemented in the mock workspace API.`,
    };
  },
  async previewWorkspaceEdit(request) {
    if (hasTauriRuntime()) {
      return invoke<WorkspaceEditPreview>("preview_workspace_edit", { request });
    }

    const affectedFiles = request.plan.affectedFiles.length > 0
      ? request.plan.affectedFiles
      : request.plan.operations.flatMap((operation) => {
          if (operation.kind === "renameFile" || operation.kind === "renameDirectory") {
            return [operation.oldPath, operation.newPath];
          }

          return [operation.path];
        });

    return {
      plan: request.plan,
      conflicts: request.plan.conflicts,
      affectedFiles: [...new Set(affectedFiles)],
      summary: request.plan.operations.map((operation) => operation.kind),
    };
  },
  async applyWorkspaceEdit(request) {
    if (hasTauriRuntime()) {
      return invoke<ApplyWorkspaceEditResult>("apply_workspace_edit", { request });
    }

    return {
      applied: false,
      conflicts: [
        {
          path: request.workspaceRoot,
          message: "Applying workspace edits is only available in the Tauri runtime.",
        },
      ],
      changedFiles: [],
    };
  },
  async getFileBlame(path) {
    if (hasTauriRuntime()) {
      return invoke<GitBlameLine[] | GitTraceUnavailable>("get_file_blame", { path });
    }

    if (!isDemoWorkspacePath(path)) {
      return {
        kind: "unavailable",
        reason: "notTracked",
        message: "File is not tracked by Git",
      };
    }

    return [
      {
        line: 1,
        commit: "abc1234",
        sourceLine: 1,
        author: "Jane Doe",
        authoredAt: "2026-06-23T10:00:00Z",
        relativeTime: "2h ago",
        summary: "Mark ArkTS entry component",
      },
      {
        line: 2,
        commit: "abc1234",
        sourceLine: 2,
        author: "Jane Doe",
        authoredAt: "2026-06-23T10:00:00Z",
        relativeTime: "2h ago",
        summary: "Mark ArkTS entry component",
      },
      {
        line: 3,
        commit: "def5678",
        sourceLine: 3,
        author: "Alex Chen",
        authoredAt: "2026-06-22T15:30:00Z",
        relativeTime: "1d ago",
        summary: "Add root Index struct",
      },
    ];
  },
  async getCommitTrace(path, commit, line) {
    if (hasTauriRuntime()) {
      return invoke<GitCommitTrace | GitTraceUnavailable>("get_commit_trace", { path, commit, line });
    }

    if (!isDemoWorkspacePath(path)) {
      return {
        kind: "unavailable",
        reason: "detailUnavailable",
        message: "Commit details unavailable",
      };
    }

    return {
      commit,
      shortCommit: commit.slice(0, 7),
      author: commit === "abc1234" ? "Jane Doe" : "Alex Chen",
      email: commit === "abc1234" ? "jane@example.com" : "alex@example.com",
      authoredAt: commit === "abc1234" ? "2026-06-23T10:00:00Z" : "2026-06-22T15:30:00Z",
      subject: commit === "abc1234" ? "Mark ArkTS entry component" : "Add root Index struct",
      relativePath: normalizePath(path).replace(/^.*DemoWorkspace[\\/]/, "").replace(/\\/g, "/"),
      selectedLine: line,
      sourceLine: line,
      patch: commit === "abc1234"
        ? "@@ -1,2 +1,2 @@\n+@Entry\n @Component"
        : "@@ -1,3 +1,3 @@\n @Entry\n @Component\n+struct Index {}",
    };
  },
  async loadSettings() {
    if (hasTauriRuntime()) {
      return invoke<AppSettings>("load_settings");
    }

    return defaultSettings();
  },
  async saveSettings(settings) {
    if (hasTauriRuntime()) {
      await invoke("save_settings", { settings });
      return;
    }

    void settings;
  },
  async createTerminalSession(request) {
    if (hasTauriRuntime()) {
      return invoke<TerminalSessionSummary>("create_terminal_session", { request });
    }

    return {
      id: "session-1",
      title: "pwsh",
      cwd: normalizePath(request.cwd ?? demoWorkspace.rootPath),
      shell: "pwsh",
      status: "idle",
    };
  },
  async listTerminalSessions() {
    if (hasTauriRuntime()) {
      return invoke<TerminalSessionSummary[]>("list_terminal_sessions");
    }

    return [];
  },
  async writeTerminalInput(request) {
    if (hasTauriRuntime()) {
      await invoke("write_terminal_input", { request });
      return;
    }

    void request;
  },
  async resizeTerminalSession(request) {
    if (hasTauriRuntime()) {
      await invoke("resize_terminal_session", { request });
      return;
    }

    void request;
  },
  async closeTerminalSession(sessionId) {
    if (hasTauriRuntime()) {
      await invoke("close_terminal_session", { sessionId });
      return;
    }

    void sessionId;
  },
  async stopTerminalSession(sessionId) {
    if (hasTauriRuntime()) {
      await invoke("stop_terminal_session", { sessionId });
      return;
    }

    void sessionId;
  },
  async runTerminalCommand(request) {
    if (hasTauriRuntime()) {
      return invoke<TerminalRunResult>("run_terminal_command", { request });
    }

    return {
      runId: request.runId,
      command: request.command,
      stdout: `${request.command} ok`,
      stderr: "",
      exitCode: 0,
      durationMs: 12,
      stopped: false,
    };
  },
  async stopTerminalCommand(runId) {
    if (hasTauriRuntime()) {
      await invoke("stop_terminal_command", { runId });
      return;
    }

    void runId;
  },
  async listDeviceLogDevices() {
    if (hasTauriRuntime()) {
      return invoke<DeviceLogDevice[]>("list_device_log_devices");
    }

    return [
      {
        id: "demo-device",
        label: "Demo HarmonyOS Device",
        status: "online",
        detail: "Mock HiLog stream",
      },
    ];
  },
  async listDeviceFaultLogs(request) {
    if (hasTauriRuntime()) {
      return invoke<DeviceFaultLogFetchResult>("list_device_fault_logs", { request });
    }

    if (request.deviceId !== "demo-device") {
      return {
        deviceId: request.deviceId,
        fetchedAt: "2026-06-25T15:21:48.000Z",
        entries: [],
        command: `hdc -t ${request.deviceId} shell faultlog -l`,
        stderr: "",
        status: "unavailable",
        message: "Device fault log demo data is only available for demo-device",
      };
    }

    return {
      deviceId: request.deviceId,
      fetchedAt: "2026-06-25T15:21:48.000Z",
      entries: [
        {
          id: "demo-fault-1",
          raw: [
            "Timestamp: 2026-06-25 15:21:48",
            "Reason: JS_ERROR",
            "Process: com.demo.camera",
            "PID: 4321",
            "BundleName: com.demo.camera",
            "Summary: Render pipeline crashed in demo mode",
            "Error: TypeError: undefined is not a function",
            "Stacktrace:",
            "  at render (pages/index.ets:12:3)",
            "  at update (pages/app.ets:44:9)",
          ].join("\n"),
        },
        {
          id: "demo-fault-2",
          raw: [
            "Timestamp: 2026-06-25 15:19:10",
            "Reason: APP_FREEZE",
            "Process: com.demo.camera",
            "PID: 4321",
            "Summary: Main thread blocked by image decode",
          ].join("\n"),
        },
      ],
      command: `hdc -t ${request.deviceId} shell faultlog -l`,
      stderr: "",
      status: "ready",
      message: "ok",
    };
  },
  async startDeviceLogStream(request) {
    if (hasTauriRuntime()) {
      return invoke<DeviceLogStreamSummary>("start_device_log_stream", { request });
    }

    void request;
    return {
      streamId: "demo-device-log-stream",
      deviceId: "demo-device",
      status: "running",
    };
  },
  async stopDeviceLogStream(streamId) {
    if (hasTauriRuntime()) {
      await invoke("stop_device_log_stream", { streamId });
      return;
    }

    void streamId;
  }
};

export function toWorkspaceViewModel(snapshot: WorkspaceSnapshot): WorkspaceViewModel {
  const store = createWorkspaceStore();
  const input: WorkspaceOpenInput = {
    rootPath: snapshot.rootPath,
    files: snapshot.files
  };

  store.openWorkspace(input);

  return {
    rootName: snapshot.rootName,
    rootPath: normalizePath(snapshot.rootPath),
    visibleFiles: store.state.visibleFiles,
    fileTree: createFileTreeNodes(store.state.visibleFiles),
    scanSummary: snapshot.scanSummary ?? {
      scannedFiles: store.state.visibleFiles.length,
      skippedEntries: Math.max(0, snapshot.files.length - store.state.visibleFiles.length),
      truncated: false,
      excludeRules: [...DEFAULT_WORKSPACE_EXCLUDES],
    },
  };
}
