import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { UsageResult } from "@/features/workspace/usage-search";
import type {
  WorkspaceIndexExplainRequest,
  WorkspaceIndexExplainResult,
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryScope,
} from "@/features/workspace/workspace-index-api-types";
import type {
  DefinitionCandidate,
  LanguageCompletionItem,
  LanguageQueryRequest,
} from "@/features/workspace/workspace-api-contract";

type InvokeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type WorkspaceIndexQueryApiDependencies = {
  invoke: InvokeCommand;
  hasTauriRuntime: () => boolean;
};

export type WorkspaceIndexQueryApi = {
  queryWorkspaceQuickOpen(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceSearchEverywhere(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceCandidates(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number, cursor?: number | null): Promise<SearchCandidate[]>;
  queryWorkspaceCandidatesWithReadiness(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number, cursor?: number | null): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryWorkspaceFileSymbols(rootPath: string, filePath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceFileSymbolsWithReadiness(rootPath: string, filePath: string, query: string, limit: number): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryDefinitionCandidatesWithReadiness(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>;
  queryUsagesWithReadiness(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<UsageResult>>;
  semanticCompleteSymbol(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<LanguageCompletionItem>>;
  explainWorkspaceIndexQuery(request: WorkspaceIndexExplainRequest): Promise<WorkspaceIndexExplainResult>;
};

export function createWorkspaceIndexQueryApi({
  invoke,
  hasTauriRuntime,
}: WorkspaceIndexQueryApiDependencies): WorkspaceIndexQueryApi {
  return {
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
    async queryWorkspaceCandidates(rootPath, query, scope, limit, cursor = null) {
      if (hasTauriRuntime()) {
        return invoke<SearchCandidate[]>("query_workspace_candidates", { rootPath, query, scope, limit, cursor });
      }

      void rootPath;
      void query;
      void scope;
      void limit;
      return [];
    },
    async queryWorkspaceCandidatesWithReadiness(rootPath, query, scope, limit, cursor = null) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<SearchCandidate>>(
          "query_workspace_candidates_with_readiness",
          { rootPath, query, scope, limit, cursor },
        );
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
        return invoke<WorkspaceIndexQueryEnvelope<SearchCandidate>>(
          "query_workspace_file_symbols_with_readiness",
          { rootPath, filePath, query, limit },
        );
      }

      void filePath;
      void query;
      void limit;
      return emptyIndexQueryEnvelope(rootPath);
    },
    async queryDefinitionCandidatesWithReadiness(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>(
          "query_definition_candidates_with_readiness",
          { rootPath, request },
        );
      }

      void request;
      return emptyIndexQueryEnvelope(rootPath);
    },
    async queryUsagesWithReadiness(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<UsageResult>>("query_usages_with_readiness", { rootPath, request });
      }

      void request;
      return emptyIndexQueryEnvelope(rootPath);
    },
    async semanticCompleteSymbol(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<LanguageCompletionItem>>("semantic_complete_symbol", { rootPath, request });
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
  };
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
