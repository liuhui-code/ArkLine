import {
  capSearchEverywhereCandidates,
  orderSearchEverywhereCandidates,
} from "@/components/layout/search-overlay-model";
import { filterSearchCandidatesByScope, searchEverywhereEntityCandidates as filterEntityCandidates } from "@/components/layout/app-shell-model";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
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

export function filterLegacySearchEntityCandidates(
  candidates: SearchCandidate[],
  scope: WorkspaceIndexQueryScope,
): SearchEntityQueryResult {
  return { candidates: filterSearchCandidatesByScope(candidates, scope) };
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
