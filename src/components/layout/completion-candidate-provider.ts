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
  const languageRequest = { path, line, column, content };
  await scheduleForegroundCompletionIndex(workspaceApi, rootPath, path);
  const semanticRequest = collectSemanticCompletionItems(workspaceApi, rootPath, languageRequest);
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

async function collectSemanticCompletionItems(
  workspaceApi: WorkspaceApi,
  rootPath: string | null | undefined,
  request: { path: string; line: number; column: number; content: string },
): Promise<LanguageCompletionItem[]> {
  if (rootPath && workspaceApi.semanticCompleteSymbol) {
    try {
      const envelope = await workspaceApi.semanticCompleteSymbol(rootPath, request);
      if (envelope.items.length > 0 || !workspaceApi.completeSymbol) {
        return envelope.items;
      }
    } catch {
      // Fall through to the legacy language-service completion below.
    }
  }
  return workspaceApi.completeSymbol ? workspaceApi.completeSymbol(request) : [];
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
