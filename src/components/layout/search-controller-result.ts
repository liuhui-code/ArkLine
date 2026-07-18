import type { Dispatch, SetStateAction } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { searchSessionCompat } from "@/features/search/search-session-compat";
import type { SearchSessionStore } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchControllerState = {
  searchEverywhereMode: SearchEverywhereMode;
  searchEverywhereScope: WorkspaceIndexQueryScope;
  searchEverywhereReplaceQuery: string;
  searchEverywhereOptions: WorkspaceTextSearchOptions;
};

export type SearchControllerActions = {
  setSearchEverywhereScope: Dispatch<SetStateAction<WorkspaceIndexQueryScope>>;
  setSearchEverywhereReplaceQuery: Dispatch<SetStateAction<string>>;
  setSearchEverywhereSelectedIndex: (selectedIndex: number) => void;
  openSearchOverlay: (mode: SearchEverywhereMode) => void;
  handleOverlayQueryChange: (value: string) => void;
  handleOverlayQueryDraftChange: (value: string) => void;
  resetSearchOverlayState: () => void;
  moveSearchEverywhereSelection: (direction: 1 | -1) => void;
  openSearchEverywhereResult: (path: string, line: number, column: number) => Promise<void>;
  openSearchEverywhereCandidate: (candidate: SearchCandidate) => Promise<void>;
  openSelectedSearchEverywhereResult: () => Promise<void>;
  loadNextSearchEverywherePage: (selectIndexAfterLoad?: number) => Promise<void>;
  toggleSearchEverywhereCaseSensitive: () => void;
  toggleSearchEverywhereWholeWord: () => void;
};

export type SearchControllerResultInput = {
  state: SearchControllerState;
  actions: SearchControllerActions;
  searchSessionStore: SearchSessionStore;
};

export function buildSearchEverywhereControllerResult({
  state,
  actions,
  searchSessionStore,
}: SearchControllerResultInput) {
  return searchSessionCompat({
    ...state,
    searchSessionStore,
    ...actions,
  }, searchSessionStore);
}
