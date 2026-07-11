import {
  capSearchEverywhereCandidates,
  orderSearchEverywhereCandidates,
} from "@/components/layout/search-overlay-model";
import { filterSearchCandidatesByScope, searchEverywhereEntityCandidates as filterEntityCandidates } from "@/components/layout/app-shell-model";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type { WorkspaceIndexQueryEnvelope } from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchEntityQueryResult = {
  candidates: SearchCandidate[];
  explain?: string[];
  nextCursor?: number | null;
};

export type SearchEntityPatchInput = SearchEntityQueryResult & {
  query: string;
  scope: WorkspaceIndexQueryScope;
  displayLimit: number;
  activePath: string | null;
  recentPaths: string[];
  readinessCursorAvailable: boolean;
};

export type SearchEntityQueryExecutionInput = {
  runReadiness?: () => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  runIndexed?: () => Promise<SearchCandidate[]>;
  runLegacy?: () => Promise<SearchCandidate[]>;
  runLocal: () => SearchCandidate[];
  scope: WorkspaceIndexQueryScope;
  onReadiness: (envelope: WorkspaceIndexQueryEnvelope<SearchCandidate>) => void;
};

export type SearchEntityQueryRequestInput = {
  query: string;
  scope: WorkspaceIndexQueryScope;
  limit: number;
  runReadiness?: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  runIndexed?: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => Promise<SearchCandidate[]>;
  runLegacy?: (query: string, limit: number) => Promise<SearchCandidate[]>;
  runLocal: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
  onReadiness: (envelope: WorkspaceIndexQueryEnvelope<SearchCandidate>) => void;
};

export function buildSearchEntityQueryRequest({
  query,
  scope,
  limit,
  runReadiness,
  runIndexed,
  runLegacy,
  runLocal,
  onReadiness,
}: SearchEntityQueryRequestInput): SearchEntityQueryExecutionInput {
  return {
    runReadiness: runReadiness ? () => runReadiness(query, scope, limit) : undefined,
    runIndexed: runIndexed ? () => runIndexed(query, scope, limit) : undefined,
    runLegacy: runLegacy ? () => runLegacy(query, limit) : undefined,
    runLocal: () => runLocal(query, scope, limit),
    scope,
    onReadiness,
  };
}

export function filterLegacySearchEntityCandidates(
  candidates: SearchCandidate[],
  scope: WorkspaceIndexQueryScope,
): SearchEntityQueryResult {
  return { candidates: filterSearchCandidatesByScope(candidates, scope) };
}

export async function executeSearchEntityQuery({
  runReadiness,
  runIndexed,
  runLegacy,
  runLocal,
  scope,
  onReadiness,
}: SearchEntityQueryExecutionInput): Promise<SearchEntityQueryResult> {
  if (runReadiness) {
    const envelope = await runReadiness();
    onReadiness(envelope);
    return { candidates: envelope.items, explain: envelope.explain, nextCursor: envelope.nextCursor ?? null };
  }
  if (runIndexed) {
    return { candidates: await runIndexed() };
  }
  if (runLegacy) {
    return filterLegacySearchEntityCandidates(await runLegacy(), scope);
  }
  return { candidates: runLocal() };
}

export function buildSearchEntityPatch({
  candidates,
  query,
  scope,
  displayLimit,
  activePath,
  recentPaths,
  nextCursor,
  readinessCursorAvailable,
}: SearchEntityPatchInput) {
  const visibleCandidates = filterEntityCandidates(candidates);
  const ordered = orderSearchEverywhereCandidates(visibleCandidates, { activePath, recentPaths });
  const capped = capSearchEverywhereCandidates(ordered, { scope, displayLimit });
  return {
    patch: {
      candidates: capped.items,
      truncationNotice: capped.metadata.truncated
        ? `Showing ${capped.metadata.returnedCount} of at least ${capped.metadata.fetchedCount} ${scope} result(s). Refine the query to see more.`
        : null,
      result: { query: { kind: "text" as const, query: query.trim() }, matches: [] },
      selectedIndex: 0,
      previewContent: null,
      entityNextCursor: readinessCursorAvailable && capped.metadata.truncated ? capped.items.length : nextCursor ?? null,
      textNextCursor: null,
      textPageLoading: false,
    },
    visibleCount: visibleCandidates.length,
  };
}

export const searchEverywhereEntityCandidates = filterEntityCandidates;

export function buildSearchEntityAppendPatch(
  currentCandidates: SearchCandidate[],
  nextCandidates: SearchCandidate[],
  nextCursor: number | null | undefined,
  selectedIndex: number,
) {
  return {
    candidates: [...currentCandidates, ...filterEntityCandidates(nextCandidates)],
    entityNextCursor: nextCursor ?? null,
    textPageLoading: false,
    selectedIndex,
  };
}
