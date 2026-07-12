import { describe, expect, it, vi } from "vitest";
import { createSearchSessionLifecycle } from "@/components/layout/search-session-lifecycle";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";
import { createSearchSessionStore } from "@/features/search/search-session-store";

describe("search session lifecycle", () => {
  it("invalidates foreground query state and clears transient search state", () => {
    const cancel = vi.fn();
    const interactionRuntime = createSearchInteractionRuntime({ cancel });
    const sessionStore = createSearchSessionStore();
    interactionRuntime.startQuery("text");
    sessionStore.patch({ previewContent: "preview", textPageLoading: true });
    const lifecycle = createSearchSessionLifecycle({
      interactionRuntime,
      sessionStore,
      navigationCloseHandledRef: { current: false },
      setActiveOverlay: vi.fn(),
    });

    lifecycle.invalidateSearchSession();

    expect(cancel).toHaveBeenCalledWith("text", 1);
    expect(sessionStore.getSnapshot()).toMatchObject({
      previewContent: null,
      textPageLoading: false,
    });
  });

  it("closes the overlay for navigation and invalidates active foreground work", () => {
    const cancel = vi.fn();
    const setActiveOverlay = vi.fn();
    const navigationCloseHandledRef = { current: false };
    const interactionRuntime = createSearchInteractionRuntime({ cancel });
    interactionRuntime.startQuery("searchEverywhere");
    const lifecycle = createSearchSessionLifecycle({
      interactionRuntime,
      sessionStore: createSearchSessionStore(),
      navigationCloseHandledRef,
      setActiveOverlay,
    });

    lifecycle.closeSearchOverlayForNavigation();

    expect(navigationCloseHandledRef.current).toBe(true);
    expect(cancel).toHaveBeenCalledWith("searchEverywhere", 1);
    expect(setActiveOverlay).toHaveBeenCalledWith("none");
  });
});
