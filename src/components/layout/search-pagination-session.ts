import { textSearchPartialNotice } from "@/components/layout/search-everywhere-controller-model";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";

export type SearchSelectionMoveInput = {
  mode: SearchEverywhereMode;
  direction: 1 | -1;
  selectedIndex: number;
  resultCount: number;
  canLoadMore: boolean;
};

export type SearchSelectionMoveResult =
  | { kind: "none" }
  | { kind: "select"; selectedIndex: number }
  | { kind: "loadMore"; selectIndexAfterLoad: number };

export function resolveSearchSelectionMove({
  direction,
  selectedIndex,
  resultCount,
  canLoadMore,
}: SearchSelectionMoveInput): SearchSelectionMoveResult {
  if (resultCount <= 0) return { kind: "none" };
  const normalized = Math.min(Math.max(selectedIndex, 0), resultCount - 1);
  if (direction > 0 && canLoadMore && normalized === resultCount - 1) {
    return { kind: "loadMore", selectIndexAfterLoad: resultCount };
  }
  return { kind: "select", selectedIndex: (normalized + direction + resultCount) % resultCount };
}

export function buildTextSearchAppendPatch(
  session: Pick<SearchSessionSnapshot, "result" | "selectedIndex">,
  result: WorkspaceTextSearchResult,
  selectedIndex?: number,
) {
  return {
    result: { ...result, matches: [...session.result.matches, ...result.matches] },
    truncationNotice: textSearchPartialNotice(result),
    textNextCursor: result.nextCursor ?? null,
    textPageLoading: false,
    selectedIndex: selectedIndex ?? session.selectedIndex,
  };
}
