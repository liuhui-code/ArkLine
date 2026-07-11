import type { Dispatch, SetStateAction } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import { searchOverlayLabel } from "@/components/layout/search-everywhere-controller-model";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchSessionSnapshot } from "@/features/search/search-session-store";

export type ResetSearchOverlayStateActionInput = {
  mode: SearchEverywhereMode;
  now?: () => number;
  invalidateSearchSession: () => void;
  resetDebouncedSearchQuery: () => void;
  patchSearchSession: (patch: Partial<SearchSessionSnapshot>) => void;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
};

export type CloseSearchOverlayForNavigationActionInput = {
  navigationCloseHandledRef: { current: boolean };
  invalidateSearchSession: () => void;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
};

export function resetSearchOverlayStateAction({
  mode,
  now = Date.now,
  invalidateSearchSession,
  resetDebouncedSearchQuery,
  patchSearchSession,
  recordUiInteraction,
}: ResetSearchOverlayStateActionInput) {
  const startedAt = now();
  invalidateSearchSession();
  recordUiInteraction?.("searchClose", searchOverlayLabel(mode), startedAt, now());
  resetDebouncedSearchQuery();
  patchSearchSession({ selectedIndex: 0, previewContent: null });
}

export function closeSearchOverlayForNavigationAction({
  navigationCloseHandledRef,
  invalidateSearchSession,
  setActiveOverlay,
}: CloseSearchOverlayForNavigationActionInput) {
  invalidateSearchSession();
  navigationCloseHandledRef.current = true;
  setActiveOverlay("none");
}
