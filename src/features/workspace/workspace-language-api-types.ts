export type SemanticSupervisorSnapshot = {
  status: string;
  restartCount: number;
  restoredDocumentCount: number;
  consecutiveFailures: number;
  lastHeartbeatEpochMs: number | null;
  retryAfterMs: number;
  lastError: string | null;
  runtime: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
    uptimeMs: number;
    providerLatencies?: Record<string, {
      count: number;
      p50Us: number;
      p95Us: number;
      maxUs: number;
    }>;
  } | null;
  memoryBudgetBytes: number;
  requestActor?: {
    running: boolean;
    queued: number;
    completed: number;
    superseded: number;
    failed: number;
  };
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
  capabilities?: LanguageServiceCapability[];
  detail: string;
  supervisor?: SemanticSupervisorSnapshot;
};

export type LanguageServiceCapability =
  | "hover"
  | "definition"
  | "completion"
  | "signatureHelp"
  | "documentSymbols"
  | "findUsages"
  | "codeActions"
  | "generateCode"
  | "renameSymbol"
  | "refactor";

export type SemanticAvailability = "ready" | "partial" | "unavailable";
