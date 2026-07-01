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
  const fileIndexRequest = rootPath && workspaceApi.queryWorkspaceFileSymbols
    ? workspaceApi.queryWorkspaceFileSymbols(rootPath, path, queryText, 80)
    : Promise.resolve<SearchCandidate[]>([]);
  const workspaceIndexRequest = rootPath && workspaceApi.queryWorkspaceCandidates && queryText
    ? workspaceApi.queryWorkspaceCandidates(rootPath, queryText, "all", 80)
    : Promise.resolve<SearchCandidate[]>([]);

  const semanticItems = await semanticRequest;
  const [fileIndexResult, workspaceIndexResult] = await Promise.allSettled([fileIndexRequest, workspaceIndexRequest]);
  const fileIndexedItems = fileIndexResult.status === "fulfilled"
    ? fileIndexResult.value
      .filter(isCompletionCandidate)
      .map((candidate) => candidateToCompletionItem(candidate, "currentFile"))
    : [];
  const workspaceIndexedItems = workspaceIndexResult.status === "fulfilled"
    ? workspaceIndexResult.value
      .filter(isCompletionCandidate)
      .map((candidate) => candidateToCompletionItem(candidate, "workspace"))
    : [];

  return mergeCompletionItems(semanticItems, fileIndexedItems, workspaceIndexedItems, keywordCompletionItems(queryText));
}

function isCompletionCandidate(candidate: SearchCandidate) {
  return candidate.source === "symbol" || candidate.source === "class" || candidate.source === "api";
}
