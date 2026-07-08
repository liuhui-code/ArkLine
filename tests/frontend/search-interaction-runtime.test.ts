import { describe, expect, it, vi } from "vitest";
import { createSearchInteractionRuntime } from "@/features/search/search-interaction-runtime";

describe("search interaction runtime", () => {
  it("invalidates older query generations when a new query starts", () => {
    const cancel = vi.fn();
    const runtime = createSearchInteractionRuntime({ cancel });

    const first = runtime.startQuery("searchEverywhere");
    const second = runtime.startQuery("text");

    expect(runtime.isCurrentQuery(first)).toBe(false);
    expect(runtime.isCurrentQuery(second)).toBe(true);
    expect(cancel).toHaveBeenCalledWith("searchEverywhere", first);
  });

  it("cancels the active query when foreground interaction invalidates work", () => {
    const cancel = vi.fn();
    const runtime = createSearchInteractionRuntime({ cancel });
    const generation = runtime.startQuery("searchEverywhere");

    runtime.invalidateForeground();

    expect(runtime.isCurrentQuery(generation)).toBe(false);
    expect(cancel).toHaveBeenCalledWith("searchEverywhere", generation);
  });

  it("can invalidate foreground work without cancelling backend search", () => {
    const cancel = vi.fn();
    const runtime = createSearchInteractionRuntime({ cancel });
    const generation = runtime.startQuery("text");

    runtime.invalidateForeground({ cancelActive: false });

    expect(runtime.isCurrentQuery(generation)).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps preview generations separate from query generations", () => {
    const runtime = createSearchInteractionRuntime();
    const query = runtime.startQuery("text");
    const preview = runtime.startPreview();

    runtime.invalidatePreview();

    expect(runtime.isCurrentQuery(query)).toBe(true);
    expect(runtime.isCurrentPreview(preview)).toBe(false);
  });

  it("does not cancel a query after it has finished", () => {
    const cancel = vi.fn();
    const runtime = createSearchInteractionRuntime({ cancel });
    const generation = runtime.startQuery("searchEverywhere");

    runtime.finishQuery(generation);
    runtime.invalidateForeground();

    expect(cancel).not.toHaveBeenCalled();
  });
});
