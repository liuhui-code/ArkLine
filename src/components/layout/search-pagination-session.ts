import { textSearchPartialNotice } from "@/components/layout/search-everywhere-controller-model";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";

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
