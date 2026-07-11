import {
  parseSearchQuery,
  type WorkspaceTextSearchOptions,
  type WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryEnvelope, WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchTextQueryPlan =
  | { kind: "clear"; query: string }
  | { kind: "indexed"; query: string }
  | { kind: "fallback"; query: string };

export type SearchTextQueryPlanInput = {
  query: string;
  minimumQueryLength: number;
  options: WorkspaceTextSearchOptions;
  dirty: boolean;
  indexedAvailable: boolean;
};

export type SearchTextQueryExecutionResult = {
  result: WorkspaceTextSearchResult;
  suppressMissExplain: boolean;
};

export type SearchTextQueryExecutionInput = {
  plan: SearchTextQueryPlan;
  runIndexed: () => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  runFallback: () => Promise<WorkspaceTextSearchResult>;
  convertIndexed: (items: SearchCandidate[]) => WorkspaceTextSearchResult;
  onIndexedReadiness: (readiness: WorkspaceIndexReadiness) => void;
};

export function buildTextSearchResultPatch(result: WorkspaceTextSearchResult) {
  return {
    result,
    previewContent: null,
    selectedIndex: 0,
    entityNextCursor: null,
    textNextCursor: result.nextCursor ?? null,
    textPageLoading: false,
  };
}

export function shouldExplainTextSearchMiss(
  result: WorkspaceTextSearchResult,
  suppressMissExplain: boolean,
  query: string,
) {
  return !suppressMissExplain && result.query.kind !== "invalid" && result.matches.length === 0 && Boolean(query.trim());
}

export function planSearchTextQuery({
  query,
  minimumQueryLength,
  options,
  dirty,
  indexedAvailable,
}: SearchTextQueryPlanInput): SearchTextQueryPlan {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < minimumQueryLength) {
    return { kind: "clear", query: normalizedQuery };
  }
  const parsedTextQuery = parseSearchQuery(query);
  const canUseIndexedTextFacade = indexedAvailable
    && parsedTextQuery.kind === "text"
    && Boolean(parsedTextQuery.query)
    && !options.caseSensitive
    && !options.wholeWord
    && !dirty;
  return canUseIndexedTextFacade ? { kind: "indexed", query } : { kind: "fallback", query };
}

export async function executeSearchTextQuery({
  plan,
  runIndexed,
  runFallback,
  convertIndexed,
  onIndexedReadiness,
}: SearchTextQueryExecutionInput): Promise<SearchTextQueryExecutionResult> {
  if (plan.kind !== "indexed") {
    return { result: await runFallback(), suppressMissExplain: false };
  }
  const envelope = await runIndexed();
  onIndexedReadiness(envelope.readiness);
  if (envelope.readiness.state === "missing" && envelope.items.length === 0) {
    return { result: await runFallback(), suppressMissExplain: false };
  }
  return {
    result: convertIndexed(envelope.items),
    suppressMissExplain: envelope.readiness.state !== "ready",
  };
}
