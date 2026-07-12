import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import {
  closeSearchOverlayForNavigationAction,
} from "@/components/layout/search-overlay-actions";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { SearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import type { SearchSessionStore } from "@/features/search/search-session-store";

export type SearchSessionLifecycleOptions = {
  interactionRuntime: SearchInteractionRuntime;
  sessionStore: SearchSessionStore;
  navigationCloseHandledRef: MutableRefObject<boolean>;
  setActiveOverlay: Dispatch<SetStateAction<OverlayKey>>;
};

export function createSearchSessionLifecycle({
  interactionRuntime,
  sessionStore,
  navigationCloseHandledRef,
  setActiveOverlay,
}: SearchSessionLifecycleOptions) {
  function invalidateSearchSession(cancelRunning = true) {
    interactionRuntime.invalidateForeground({ cancelActive: cancelRunning });
    sessionStore.patch({ previewContent: null, textPageLoading: false });
  }

  function closeSearchOverlayForNavigation() {
    closeSearchOverlayForNavigationAction({
      navigationCloseHandledRef,
      invalidateSearchSession,
      setActiveOverlay,
    });
  }

  return {
    invalidateSearchSession,
    closeSearchOverlayForNavigation,
  };
}
