import {
  candidateToCompletionItem,
  keywordCompletionItems,
  mergeCompletionItems,
} from "@/components/layout/indexed-completion-model";
import type { LanguageCompletionItem, WorkspaceApi } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexQueryEnvelope } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type CompletionCandidateRequest = {
  workspaceApi: WorkspaceApi;
  rootPath?: string | null;
  path: string;
  line: number;
  column: number;
  content: string;
  query: string;
  replacePrefix: string;
};

export type CompletionCandidateResult = {
  items: LanguageCompletionItem[];
  explain: string[];
};

export async function collectCompletionCandidates(request: CompletionCandidateRequest): Promise<LanguageCompletionItem[]> {
  const result = await collectCompletionCandidateResult(request);
  return result.items;
}

export async function collectCompletionCandidateResult({
  workspaceApi,
  rootPath,
  path,
  line,
  column,
  content,
  query,
  replacePrefix,
}: CompletionCandidateRequest): Promise<CompletionCandidateResult> {
  const queryText = query || replacePrefix;
  const languageRequest = { path, line, column, content };
  await scheduleForegroundCompletionIndex(workspaceApi, rootPath, path);
  const semanticRequest = collectSemanticCompletionResult(workspaceApi, rootPath, languageRequest);
  const fileIndexRequest = rootPath && workspaceApi.queryWorkspaceFileSymbolsWithReadiness
    ? workspaceApi.queryWorkspaceFileSymbolsWithReadiness(rootPath, path, queryText, 80)
    : Promise.resolve(indexItemsEnvelope<SearchCandidate>([]));
  const workspaceIndexRequest = rootPath && workspaceApi.queryWorkspaceCandidatesWithReadiness && queryText
    ? workspaceApi.queryWorkspaceCandidatesWithReadiness(rootPath, queryText, "all", 80)
    : Promise.resolve(indexItemsEnvelope<SearchCandidate>([]));

  const semanticResult = await semanticRequest;
  const semanticItems = semanticResult.items;
  const hideStaleIndexedItems = hasExactSemanticCompletion(semanticItems, queryText);
  const [fileIndexResult, workspaceIndexResult] = await Promise.allSettled([fileIndexRequest, workspaceIndexRequest]);
  const explain = [
    ...semanticResult.explain,
    ...fulfilledExplain(fileIndexResult),
    ...fulfilledExplain(workspaceIndexResult),
  ];
  const fileIndexedItems = fileIndexResult.status === "fulfilled"
    ? fileIndexResult.value.items
      .filter((candidate) => isCompletionCandidate(candidate) && !shouldHideIndexedCandidate(candidate, hideStaleIndexedItems))
      .map((candidate) => candidateToCompletionItem(candidate, "currentFile"))
    : [];
  const workspaceIndexedItems = workspaceIndexResult.status === "fulfilled"
    ? workspaceIndexResult.value.items
      .filter((candidate) => isCompletionCandidate(candidate) && !shouldHideIndexedCandidate(candidate, hideStaleIndexedItems))
      .map((candidate) => candidateToCompletionItem(candidate, "workspace"))
    : [];

  return {
    items: mergeCompletionItems(semanticItems, fileIndexedItems, workspaceIndexedItems, keywordCompletionItems(queryText)),
    explain,
  };
}

async function scheduleForegroundCompletionIndex(
  workspaceApi: WorkspaceApi,
  rootPath: string | null | undefined,
  path: string,
) {
  if (!rootPath || !workspaceApi.scheduleForegroundCompletionIndex) {
    return;
  }
  try {
    await workspaceApi.scheduleForegroundCompletionIndex(rootPath, [path]);
  } catch {
    // Completion must stay responsive when foreground reindex scheduling is unavailable.
  }
}

async function collectSemanticCompletionResult(
  workspaceApi: WorkspaceApi,
  rootPath: string | null | undefined,
  request: { path: string; line: number; column: number; content: string },
): Promise<CompletionCandidateResult> {
  if (rootPath && workspaceApi.semanticCompleteSymbol) {
    try {
      const envelope = await workspaceApi.semanticCompleteSymbol(rootPath, request);
      if (envelope.items.length > 0 || !workspaceApi.completeSymbol) {
        return {
          items: envelope.items,
          explain: envelope.explain ?? [],
        };
      }
      return {
        items: await workspaceApi.completeSymbol(request),
        explain: envelope.explain ?? [],
      };
    } catch {
      // Fall through to the legacy language-service completion below.
    }
  }
  return {
    items: workspaceApi.completeSymbol ? await workspaceApi.completeSymbol(request) : [],
    explain: [],
  };
}

function indexItemsEnvelope<T>(items: T[]): Pick<WorkspaceIndexQueryEnvelope<T>, "items" | "explain"> {
  return { items, explain: [] };
}

function fulfilledExplain<T>(result: PromiseSettledResult<Pick<WorkspaceIndexQueryEnvelope<T>, "items" | "explain">>) {
  return result.status === "fulfilled" ? result.value.explain ?? [] : [];
}

function isCompletionCandidate(candidate: SearchCandidate) {
  return candidate.source === "symbol" || candidate.source === "class" || candidate.source === "api";
}

function shouldHideIndexedCandidate(candidate: SearchCandidate, hideStaleIndexedItems: boolean) {
  return hideStaleIndexedItems && candidate.freshness === "stale";
}

function hasExactSemanticCompletion(items: LanguageCompletionItem[], query: string) {
  const normalizedQuery = normalizeCompletionLabel(query);
  if (!normalizedQuery) {
    return false;
  }
  return items.some((item) => {
    const labels = [item.label, item.filterText, item.insertText].filter(Boolean);
    return labels.some((label) => normalizeCompletionLabel(label) === normalizedQuery);
  });
}

function normalizeCompletionLabel(value: string | undefined) {
  return (value ?? "").replace(/\(\)$/u, "").trim().toLowerCase();
}
