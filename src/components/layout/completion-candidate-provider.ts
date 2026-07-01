import {
  candidateToCompletionItem,
  keywordCompletionItems,
  mergeCompletionItems,
} from "@/components/layout/indexed-completion-model";
import type { LanguageCompletionItem, WorkspaceApi } from "@/features/workspace/workspace-api";
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

export async function collectCompletionCandidates({
  workspaceApi,
  rootPath,
  path,
  line,
  column,
  content,
  query,
  replacePrefix,
}: CompletionCandidateRequest): Promise<LanguageCompletionItem[]> {
  const queryText = query || replacePrefix;
  const semanticRequest = workspaceApi.completeSymbol
    ? workspaceApi.completeSymbol({ path, line, column, content })
    : Promise.resolve<LanguageCompletionItem[]>([]);
  const fileIndexRequest = rootPath && workspaceApi.queryWorkspaceFileSymbolsWithReadiness
    ? workspaceApi.queryWorkspaceFileSymbolsWithReadiness(rootPath, path, queryText, 80).then((envelope) => envelope.items)
    : rootPath && workspaceApi.queryWorkspaceFileSymbols
      ? workspaceApi.queryWorkspaceFileSymbols(rootPath, path, queryText, 80)
      : Promise.resolve<SearchCandidate[]>([]);
  const workspaceIndexRequest = rootPath && workspaceApi.queryWorkspaceCandidatesWithReadiness && queryText
    ? workspaceApi.queryWorkspaceCandidatesWithReadiness(rootPath, queryText, "all", 80).then((envelope) => envelope.items)
    : rootPath && workspaceApi.queryWorkspaceCandidates && queryText
      ? workspaceApi.queryWorkspaceCandidates(rootPath, queryText, "all", 80)
      : Promise.resolve<SearchCandidate[]>([]);

  const semanticItems = await semanticRequest;
  const hideStaleIndexedItems = hasExactSemanticCompletion(semanticItems, queryText);
  const [fileIndexResult, workspaceIndexResult] = await Promise.allSettled([fileIndexRequest, workspaceIndexRequest]);
  const fileIndexedItems = fileIndexResult.status === "fulfilled"
    ? fileIndexResult.value
      .filter((candidate) => isCompletionCandidate(candidate) && !shouldHideIndexedCandidate(candidate, hideStaleIndexedItems))
      .map((candidate) => candidateToCompletionItem(candidate, "currentFile"))
    : [];
  const workspaceIndexedItems = workspaceIndexResult.status === "fulfilled"
    ? workspaceIndexResult.value
      .filter((candidate) => isCompletionCandidate(candidate) && !shouldHideIndexedCandidate(candidate, hideStaleIndexedItems))
      .map((candidate) => candidateToCompletionItem(candidate, "workspace"))
    : [];

  return mergeCompletionItems(semanticItems, fileIndexedItems, workspaceIndexedItems, keywordCompletionItems(queryText));
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
