import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { UsageResult } from "@/features/workspace/usage-search";
import { WORKSPACE_INDEX_QUERY_CONTRACT_VERSION } from "@/features/workspace/workspace-index-api-types";
import type {
  WorkspaceIndexExplainRequest,
  WorkspaceIndexQueryLane,
  WorkspaceIndexExplainResult,
  LanguageQueryBrokerEnvelope,
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexQueryCapability,
  WorkspaceIndexQueryScope,
  WorkspaceSearchRankingContext,
} from "@/features/workspace/workspace-index-api-types";
import type {
  CallHierarchyResult,
  DefinitionCandidate,
  LanguageCompletionItem,
  LanguageQueryRequest,
  RenameImpactResult,
  TypeHierarchyResult,
} from "@/features/workspace/workspace-api-contract";

type InvokeCommand = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

type WorkspaceIndexQueryApiDependencies = {
  invoke: InvokeCommand;
  hasTauriRuntime: () => boolean;
};

export type WorkspaceIndexQueryApi = {
  queryWorkspaceQuickOpen(rootPath: string, query: string, limit: number): Promise<SearchCandidate[]>;
  queryWorkspaceCandidatesWithReadiness(rootPath: string, query: string, scope: WorkspaceIndexQueryScope, limit: number, cursor?: number | null, context?: WorkspaceSearchRankingContext, generation?: number, deadlineMs?: number, queryLane?: WorkspaceIndexQueryLane): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryWorkspaceFileSymbolsWithReadiness(rootPath: string, filePath: string, query: string, limit: number, cursor?: number | null): Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  queryDefinitionCandidatesWithReadiness(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>;
  queryUsagesWithReadiness(rootPath: string, request: LanguageQueryRequest): Promise<WorkspaceIndexQueryEnvelope<UsageResult>>;
  queryRenameImpact(rootPath: string, request: LanguageQueryRequest): Promise<RenameImpactResult | null>;
  queryCallHierarchy(rootPath: string, request: LanguageQueryRequest): Promise<CallHierarchyResult | null>;
  queryTypeHierarchy(rootPath: string, request: LanguageQueryRequest): Promise<TypeHierarchyResult | null>;
  semanticCompleteSymbol(rootPath: string, request: LanguageQueryRequest, requestGeneration?: number): Promise<WorkspaceIndexQueryEnvelope<LanguageCompletionItem>>;
  queryLanguageDefinition(rootPath: string, request: LanguageQueryRequest, requestGeneration: number, documentVersion?: number | null): Promise<LanguageQueryBrokerEnvelope<DefinitionCandidate>>;
  queryLanguageCompletion(rootPath: string, request: LanguageQueryRequest, requestGeneration: number, documentVersion?: number | null): Promise<LanguageQueryBrokerEnvelope<LanguageCompletionItem>>;
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
    async queryWorkspaceCandidatesWithReadiness(rootPath, query, scope, limit, cursor = null, context, generation, deadlineMs, queryLane) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<SearchCandidate>>(
          "query_workspace_candidates_with_readiness",
          {
            rootPath,
            query,
            scope,
            limit,
            cursor,
            context,
            generation,
            deadlineMs,
            ...(queryLane ? { queryLane } : {}),
          },
        );
      }

      void query;
      void scope;
      void limit;
      void context;
      return emptyIndexQueryEnvelope(rootPath, "searchEverywhere");
    },
    async queryWorkspaceFileSymbolsWithReadiness(rootPath, filePath, query, limit, cursor = null) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<SearchCandidate>>(
          "query_workspace_file_symbols_with_readiness",
          { rootPath, filePath, query, limit, cursor },
        );
      }

      void filePath;
      void query;
      void limit;
      return emptyIndexQueryEnvelope(rootPath, "fileSymbols");
    },
    async queryDefinitionCandidatesWithReadiness(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<DefinitionCandidate>>(
          "query_definition_candidates_with_readiness",
          { rootPath, request },
        );
      }

      void request;
      return emptyIndexQueryEnvelope(rootPath, "definition");
    },
    async queryUsagesWithReadiness(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<UsageResult>>("query_usages_with_readiness", { rootPath, request });
      }

      void request;
      return emptyIndexQueryEnvelope(rootPath, "usages");
    },
    async queryRenameImpact(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<RenameImpactResult | null>("query_rename_impact", { rootPath, request });
      }

      void rootPath;
      void request;
      return null;
    },
    async queryCallHierarchy(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<CallHierarchyResult | null>("query_call_hierarchy", { rootPath, request });
      }

      void rootPath;
      void request;
      return null;
    },
    async queryTypeHierarchy(rootPath, request) {
      if (hasTauriRuntime()) {
        return invoke<TypeHierarchyResult | null>("query_type_hierarchy", { rootPath, request });
      }

      void rootPath;
      void request;
      return null;
    },
    async semanticCompleteSymbol(rootPath, request, requestGeneration) {
      if (hasTauriRuntime()) {
        return invoke<WorkspaceIndexQueryEnvelope<LanguageCompletionItem>>(
          "semantic_complete_symbol",
          { rootPath, request, requestGeneration },
        );
      }

      void request;
      void requestGeneration;
      return emptyIndexQueryEnvelope(rootPath, "completion");
    },
    async queryLanguageDefinition(rootPath, request, requestGeneration, documentVersion) {
      if (hasTauriRuntime()) {
        return invoke<LanguageQueryBrokerEnvelope<DefinitionCandidate>>(
          "query_language_definition",
          { rootPath, request, requestGeneration, documentVersion },
        );
      }
      return emptyLanguageBrokerEnvelope(rootPath, "definition", requestGeneration, documentVersion);
    },
    async queryLanguageCompletion(rootPath, request, requestGeneration, documentVersion) {
      if (hasTauriRuntime()) {
        return invoke<LanguageQueryBrokerEnvelope<LanguageCompletionItem>>(
          "query_language_completion",
          { rootPath, request, requestGeneration, documentVersion },
        );
      }
      return emptyLanguageBrokerEnvelope(rootPath, "completion", requestGeneration, documentVersion);
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

function emptyLanguageBrokerEnvelope<T>(
  rootPath: string,
  capability: WorkspaceIndexQueryCapability,
  requestGeneration: number,
  documentGeneration: number | null = null,
): LanguageQueryBrokerEnvelope<T> {
  return {
    ...emptyIndexQueryEnvelope<T>(rootPath, capability),
    requestGeneration,
    documentGeneration,
    targetGeneration: null,
    provider: "none",
    confidence: "none",
    fallbackUsed: false,
    missReason: "Language query broker is unavailable outside the desktop runtime",
    explain: ["provider:none", "runtime:unavailable"],
  };
}

function emptyIndexQueryEnvelope<T>(
  rootPath: string,
  capability: WorkspaceIndexQueryCapability,
): WorkspaceIndexQueryEnvelope<T> {
  return {
    items: [],
    contractVersion: WORKSPACE_INDEX_QUERY_CONTRACT_VERSION,
    capability,
    readiness: {
      rootPath,
      requestedGeneration: 0,
      servedGeneration: null,
      state: "missing",
      sources: ["workspaceIndex"],
      coverage: "none",
      fallbackUsed: false,
      reason: "No indexed generation is available",
      retryable: true,
    },
  };
}
