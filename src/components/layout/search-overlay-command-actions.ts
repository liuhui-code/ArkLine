import type { Dispatch, SetStateAction } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  handleSearchOverlayQueryChangeAction,
  openSearchOverlayAction,
  resetSearchOverlayStateAction,
} from "@/components/layout/search-overlay-actions";
import { toggleSearchTextOption } from "@/components/layout/search-text-options-state";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";
import type { WorkspaceTextSearchOptions } from "@/features/search/workspace-text-search";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";

export type SearchOverlayCommandActionsOptions = {
  mode: SearchEverywhereMode;
  getEditorSelectedText: () => string;
  invalidateSearchSession: () => void;
  resetDebouncedSearchQuery: () => void;
  patchSearchSession: (patch: Partial<SearchSessionSnapshot>) => void;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
  setSearchEverywhereMode: Dispatch<SetStateAction<SearchEverywhereMode>>;
  setSearchEverywhereScope: Dispatch<SetStateAction<WorkspaceIndexQueryScope>>;
  setQuickOpenQuery: (query: string) => void;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
  setSearchEverywhereOptions: Dispatch<SetStateAction<WorkspaceTextSearchOptions>>;
};

export function createSearchOverlayCommandActions(options: SearchOverlayCommandActionsOptions) {
  return {
    openSearchOverlay(mode: SearchEverywhereMode) {
      openSearchOverlayAction({ ...options, mode });
    },
    handleOverlayQueryChange(value: string) {
      handleSearchOverlayQueryChangeAction({
        value,
        invalidateSearchSession: options.invalidateSearchSession,
        setQuickOpenQuery: options.setQuickOpenQuery,
      });
    },
    resetSearchOverlayState() {
      resetSearchOverlayStateAction({
        mode: options.mode,
        invalidateSearchSession: options.invalidateSearchSession,
        resetDebouncedSearchQuery: options.resetDebouncedSearchQuery,
        patchSearchSession: options.patchSearchSession,
        recordUiInteraction: options.recordUiInteraction,
      });
    },
    toggleSearchEverywhereCaseSensitive() {
      options.setSearchEverywhereOptions((current) => toggleSearchTextOption(current, "caseSensitive"));
    },
    toggleSearchEverywhereWholeWord() {
      options.setSearchEverywhereOptions((current) => toggleSearchTextOption(current, "wholeWord"));
    },
  };
}
