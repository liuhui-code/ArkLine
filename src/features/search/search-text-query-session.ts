import { parseSearchQuery, type WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";

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
