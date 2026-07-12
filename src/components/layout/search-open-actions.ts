import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  openSearchCandidateNavigation,
  openSearchResultNavigation,
  openSelectedSearchNavigation,
} from "@/components/layout/search-navigation-action";
import type { UiInteractionKind } from "@/features/performance/ui-latency-monitor";
import type { SearchSessionStore } from "@/features/search/search-session-store";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

export type SearchOpenActionsOptions = {
  mode: SearchEverywhereMode;
  sessionStore: SearchSessionStore;
  rememberCurrentLocation: () => void;
  closeSearchOverlayForNavigation: () => void;
  navigateToLocation: (location: { path: string; line: number; column: number }, label: "Usage") => Promise<void>;
  recordUiInteraction?: (kind: UiInteractionKind, label: string, startedAt: number, endedAt: number) => void;
};

export function createSearchOpenActions({
  mode,
  sessionStore,
  rememberCurrentLocation,
  closeSearchOverlayForNavigation,
  navigateToLocation,
  recordUiInteraction,
}: SearchOpenActionsOptions) {
  return {
    openResult(path: string, line: number, column: number) {
      return openSearchResultNavigation({
        path,
        line,
        column,
        rememberCurrentLocation,
        closeSearchOverlayForNavigation,
        navigateToLocation,
        recordUiInteraction,
      });
    },
    openCandidate(candidate: SearchCandidate) {
      return openSearchCandidateNavigation({
        candidate,
        rememberCurrentLocation,
        closeSearchOverlayForNavigation,
        navigateToLocation,
        recordUiInteraction,
      });
    },
    openSelected() {
      const session = sessionStore.getSnapshot();
      return openSelectedSearchNavigation({
        mode,
        selectedIndex: session.selectedIndex,
        candidates: session.candidates,
        matches: session.result.matches,
        rememberCurrentLocation,
        closeSearchOverlayForNavigation,
        navigateToLocation,
        recordUiInteraction,
      });
    },
  };
}
