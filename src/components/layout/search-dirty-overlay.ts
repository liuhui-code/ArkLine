import type {
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import { normalizePath } from "@/features/workspace/workspace-store";

export type MergeDirtySearchOverlayInput = {
  indexed: WorkspaceTextSearchResult;
  dirty: WorkspaceTextSearchResult | null;
  dirtyPaths: string[];
  limit: number;
};

export function mergeDirtySearchOverlay({
  indexed,
  dirty,
  dirtyPaths,
  limit,
}: MergeDirtySearchOverlayInput): WorkspaceTextSearchResult {
  const dirtyPathSet = new Set(dirtyPaths.map(normalizePath));
  const indexedMatches = indexed.matches.filter(
    (match) => !dirtyPathSet.has(normalizePath(match.path)),
  );
  const dirtyMatches = dirty?.matches ?? [];
  const combined = [...dirtyMatches, ...indexedMatches];
  const matches = combined.slice(0, limit);
  const overlayTruncated = combined.length > matches.length || Boolean(dirty?.limitReached);

  return {
    ...indexed,
    matches,
    partial: Boolean(indexed.partial || overlayTruncated),
    searchedFiles: (indexed.searchedFiles ?? 0) + (dirty?.searchedFiles ?? 0),
    limitReached: Boolean(indexed.limitReached || overlayTruncated),
  };
}
