import {
  capSearchEverywhereCandidates,
  orderSearchEverywhereCandidates,
} from "@/components/layout/search-overlay-model";
import { searchEverywhereEntityCandidates as filterEntityCandidates } from "@/components/layout/app-shell-model";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type {
  WorkspaceIndexQueryEnvelope,
  WorkspaceIndexReadiness,
} from "@/features/workspace/workspace-index-api-types";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchEntityQueryResult = {
  candidates: SearchCandidate[];
  explain?: string[];
  nextCursor?: number | null;
  readiness?: WorkspaceIndexReadiness;
};

export type SearchEntityPatchInput = SearchEntityQueryResult & {
  query: string;
  scope: WorkspaceIndexQueryScope;
  displayLimit: number;
  activePath: string | null;
  recentPaths: string[];
  openedPaths: string[];
  readinessCursorAvailable: boolean;
};

export type SearchEntityQueryExecutionInput = {
  runReadiness?: () => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  runLocal: () => SearchCandidate[];
};

export type SearchEntityQueryRequestInput = {
  query: string;
  scope: WorkspaceIndexQueryScope;
  limit: number;
  runReadiness?: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  runLocal: (query: string, scope: WorkspaceIndexQueryScope, limit: number) => SearchCandidate[];
};

export function buildSearchEntityQueryRequest({
  query,
  scope,
  limit,
  runReadiness,
  runLocal,
}: SearchEntityQueryRequestInput): SearchEntityQueryExecutionInput {
  return {
    runReadiness: runReadiness ? () => runReadiness(query, scope, limit) : undefined,
    runLocal: () => runLocal(query, scope, limit),
  };
}

export async function executeSearchEntityQuery({
  runReadiness,
  runLocal,
}: SearchEntityQueryExecutionInput): Promise<SearchEntityQueryResult> {
  if (runReadiness) {
    const envelope = await runReadiness();
    return {
      candidates: envelope.items,
      explain: envelope.explain,
      nextCursor: envelope.nextCursor ?? null,
      readiness: envelope.readiness,
    };
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
  openedPaths,
  nextCursor,
  readiness,
  readinessCursorAvailable,
}: SearchEntityPatchInput) {
  const visibleCandidates = filterEntityCandidates(candidates);
  const ordered = orderSearchEverywhereCandidates(visibleCandidates, { activePath, recentPaths, openedPaths });
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
      indexReadiness: readiness ?? null,
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
