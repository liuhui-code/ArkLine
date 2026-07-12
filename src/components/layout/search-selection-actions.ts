import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  resolveSearchSelectionMove,
} from "@/components/layout/search-pagination-session";
import type { SearchSessionStore } from "@/features/search/search-session-store";

export type SearchSelectionActionInput = {
  selectedIndex: number;
  sessionStore: SearchSessionStore;
  scheduleSelectedPreview: (selectedIndex: number) => void;
};

export type SearchSelectionMoveInput = {
  mode: SearchEverywhereMode;
  direction: 1 | -1;
  sessionStore: SearchSessionStore;
  scheduleSelectedPreview: (selectedIndex: number) => void;
  loadNextPage: (selectIndexAfterLoad?: number) => void;
};

export function setSearchSelection({
  selectedIndex,
  sessionStore,
  scheduleSelectedPreview,
}: SearchSelectionActionInput) {
  sessionStore.patch({ selectedIndex });
  scheduleSelectedPreview(selectedIndex);
}

export function moveSearchSelection({
  mode,
  direction,
  sessionStore,
  scheduleSelectedPreview,
  loadNextPage,
}: SearchSelectionMoveInput) {
  const session = sessionStore.getSnapshot();
  const resultCount = mode === "searchEverywhere"
    ? session.candidates.length
    : session.result.matches.length;
  const move = resolveSearchSelectionMove({
    mode,
    direction,
    selectedIndex: session.selectedIndex,
    resultCount,
    canLoadMore: mode === "searchEverywhere"
      ? Boolean(session.entityNextCursor)
      : Boolean(session.textNextCursor),
  });
  if (move.kind === "loadMore") {
    loadNextPage(move.selectIndexAfterLoad);
    return;
  }
  if (move.kind === "select") {
    setSearchSelection({
      selectedIndex: move.selectedIndex,
      sessionStore,
      scheduleSelectedPreview,
    });
  }
}
