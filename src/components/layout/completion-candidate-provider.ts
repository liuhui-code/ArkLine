import {
  candidateToCompletionItem,
  keywordCompletionItems,
  mergeCompletionItems,
} from "@/components/layout/indexed-completion-model";
import { isMemberAccessCompletion, type CompletionPosition } from "@/components/layout/completion-context";
import { deferForegroundIndexSchedule, shouldScheduleForegroundIndex } from "@/components/layout/foreground-index-schedule-gate";
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
  contextLineText?: string;
  semanticContent?: string;
  documentVersion?: number | null;
  query: string;
  replacePrefix: string;
  requestGeneration?: number;
};

export type CompletionCandidateResult = {
  items: LanguageCompletionItem[];
  explain: string[];
};

export function collectImmediateCompletionCandidates(
  query: string,
  position?: CompletionPosition,
): LanguageCompletionItem[] {
  return position && isMemberAccessCompletion(position) ? [] : keywordCompletionItems(query);
}

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
  contextLineText,
  query,
  replacePrefix,
  requestGeneration,
  semanticContent,
  documentVersion,
}: CompletionCandidateRequest): Promise<CompletionCandidateResult> {
  const queryText = query || replacePrefix;
  const contextRequest = { path, line, column, content, lineText: contextLineText };
  const queryContent = documentVersion === null || documentVersion === undefined
    ? content
    : semanticContent;
  const languageRequest = {
    path,
    line,
    column,
    ...(queryContent !== undefined ? { content: queryContent } : {}),
    ...(documentVersion !== null && documentVersion !== undefined ? { documentVersion } : {}),
  };
  const memberAccess = isMemberAccessCompletion(contextRequest);
  if (rootPath && workspaceApi.queryLanguageCompletion) {
    const envelope = await workspaceApi.queryLanguageCompletion(
      rootPath,
      languageRequest,
      requestGeneration ?? 0,
      documentVersion,
    );
    const unavailable = envelope.provider === "none"
      && envelope.explain?.includes("runtime:unavailable");
    if (
      requestGeneration !== undefined
      && envelope.requestGeneration !== requestGeneration
      && !unavailable
    ) {
      return {
        items: [],
        explain: [...(envelope.explain ?? []), "discarded:staleRequestGeneration"],
      };
    }
    if (
      documentVersion !== null
      && documentVersion !== undefined
      && envelope.documentGeneration !== documentVersion
      && !unavailable
    ) {
      return {
        items: [],
        explain: [...(envelope.explain ?? []), "discarded:staleDocumentGeneration"],
      };
    }
    if (!unavailable) {
      if (envelope.readiness.state !== "ready") {
        scheduleForegroundCompletionIndex(workspaceApi, rootPath, path);
      }
      return {
        items: filterCompletionCandidates(memberAccess
          ? envelope.items.filter(isReceiverMemberCompletion)
          : envelope.items, queryText),
        explain: envelope.explain ?? [],
      };
    }
  }
  const semanticRequest = collectSemanticCompletionResult(
    workspaceApi,
    rootPath,
    languageRequest,
    requestGeneration,
  );
  const fileIndexRequest = !memberAccess && rootPath && workspaceApi.queryWorkspaceFileSymbolsWithReadiness
    ? workspaceApi.queryWorkspaceFileSymbolsWithReadiness(rootPath, path, queryText, 80)
    : Promise.resolve(indexItemsEnvelope<SearchCandidate>([]));
  const workspaceIndexRequest = !memberAccess && rootPath && workspaceApi.queryWorkspaceCandidatesWithReadiness && queryText
    ? workspaceApi.queryWorkspaceCandidatesWithReadiness(
      rootPath,
      queryText,
      "all",
      80,
      null,
      undefined,
      requestGeneration,
      250,
    )
    : Promise.resolve(indexItemsEnvelope<SearchCandidate>([]));

  const semanticResult = await semanticRequest;
  const semanticItems = memberAccess
    ? semanticResult.items.filter((item) => item.kind !== "keyword")
    : semanticResult.items;
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

  scheduleForegroundCompletionIndex(workspaceApi, rootPath, path);
  return {
    items: filterCompletionCandidates(mergeCompletionItems(
      semanticItems,
      fileIndexedItems,
      workspaceIndexedItems,
      collectImmediateCompletionCandidates(queryText, contextRequest),
    ), queryText),
    explain,
  };
}

function filterCompletionCandidates(items: LanguageCompletionItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return items;
  return items.filter((item) => [item.label, item.filterText, item.insertText]
    .filter((value): value is string => Boolean(value))
    .some((value) => isCompletionSubsequence(normalizedQuery, value.toLowerCase())));
}

function isCompletionSubsequence(query: string, candidate: string) {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

function isReceiverMemberCompletion(item: LanguageCompletionItem) {
  return item.kind !== "keyword" && item.kind !== "snippet";
}

function scheduleForegroundCompletionIndex(
  workspaceApi: WorkspaceApi,
  rootPath: string | null | undefined,
  path: string,
) {
  if (!rootPath || !workspaceApi.scheduleForegroundCompletionIndex) {
    return;
  }
  if (!shouldScheduleForegroundIndex("completion", rootPath, path)) {
    return;
  }
  deferForegroundIndexSchedule(() => workspaceApi.scheduleForegroundCompletionIndex!(rootPath, [path]));
}

async function collectSemanticCompletionResult(
  workspaceApi: WorkspaceApi,
  rootPath: string | null | undefined,
  request: { path: string; line: number; column: number; content?: string; documentVersion?: number },
  requestGeneration?: number,
): Promise<CompletionCandidateResult> {
  if (rootPath && workspaceApi.semanticCompleteSymbol) {
    try {
      const envelope = await workspaceApi.semanticCompleteSymbol(rootPath, request, requestGeneration);
      if (envelope.items.length > 0 || !workspaceApi.completeSymbol) {
        return {
          items: envelope.items,
          explain: envelope.explain ?? [],
        };
      }
      return {
        items: await completeLanguageSymbol(workspaceApi, request, requestGeneration, request.documentVersion),
        explain: envelope.explain ?? [],
      };
    } catch {
      // Fall through to the legacy language-service completion below.
    }
  }
  return {
    items: workspaceApi.completeSymbol
      ? await completeLanguageSymbol(workspaceApi, request, requestGeneration, request.documentVersion)
      : [],
    explain: [],
  };
}

function completeLanguageSymbol(
  workspaceApi: WorkspaceApi,
  request: { path: string; line: number; column: number; content?: string; documentVersion?: number },
  requestGeneration?: number,
  documentVersion?: number,
) {
  return workspaceApi.completeSymbol!(request, requestGeneration, documentVersion);
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
