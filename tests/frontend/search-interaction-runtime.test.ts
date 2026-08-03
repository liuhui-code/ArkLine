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

  it("applies only the latest query run", async () => {
    const runtime = createSearchInteractionRuntime();
    const apply = vi.fn();
    let resolveFirst: (value: string) => void = () => undefined;
    const first = runtime.runQuery({
      kind: "text",
      request: () => new Promise<string>((resolve) => {
        resolveFirst = resolve;
      }),
      apply,
    });
    const second = runtime.runQuery({
      kind: "text",
      request: async () => "second",
      apply,
    });

    resolveFirst("first");
    await Promise.all([first, second]);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith("second", 2);
  });

  it("tracks an already-started query without applying stale results", async () => {
    const runtime = createSearchInteractionRuntime();
    const apply = vi.fn();
    const generation = runtime.startQuery("searchEverywhere");
    const tracked = runtime.trackQuery({
      generation,
      request: Promise.resolve("first"),
      apply,
    });

    runtime.startQuery("text");
    await tracked;

    expect(apply).not.toHaveBeenCalled();
  });

  it("finishes completed query runs before later invalidation", async () => {
    const cancel = vi.fn();
    const runtime = createSearchInteractionRuntime({ cancel });

    await runtime.runQuery({
      kind: "searchEverywhere",
      request: async () => "done",
      apply: vi.fn(),
    });
    runtime.invalidateForeground();

    expect(cancel).not.toHaveBeenCalled();
  });

  it("consumes superseded and deadline failures as expected control flow", async () => {
    const onError = vi.fn();
    const runtime = createSearchInteractionRuntime({ onError });

    await runtime.runQuery({
      kind: "searchEverywhere",
      request: async () => {
        throw new Error("Workspace query superseded");
      },
      apply: vi.fn(),
    });
    await runtime.runQuery({
      kind: "text",
      request: async () => {
        throw "Workspace query deadline exceeded";
      },
      apply: vi.fn(),
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it("reports unexpected current-query failures without rejecting", async () => {
    const onError = vi.fn();
    const runtime = createSearchInteractionRuntime({ onError });
    const failure = new Error("SQLite unavailable");

    await runtime.runQuery({
      kind: "text",
      request: async () => {
        throw failure;
      },
      apply: vi.fn(),
    });

    expect(onError).toHaveBeenCalledWith(failure, 1);
  });

  it("records query, result application, and visible commit under one trace", async () => {
    const phase = { finish: vi.fn() };
    const trace = { id: "search:1", startPhase: vi.fn(() => phase), finish: vi.fn() };
    const visibleCommits: Array<() => void> = [];
    const runtime = createSearchInteractionRuntime({
      beginTrace: vi.fn(() => trace),
      scheduleVisibleCommit: (callback) => {
        visibleCommits.push(callback);
        return () => undefined;
      },
    });

    const generation = runtime.startQuery("searchEverywhere", "Entry");
    await runtime.trackQuery({
      generation,
      request: Promise.resolve("result"),
      apply: vi.fn(),
    });
    visibleCommits.shift()?.();

    expect(trace.startPhase).toHaveBeenNthCalledWith(1, "queryBroker");
    expect(trace.startPhase).toHaveBeenNthCalledWith(2, "applyResults");
    expect(trace.startPhase).toHaveBeenNthCalledWith(3, "visibleCommit");
    expect(trace.finish).toHaveBeenCalledWith("ok");
  });

  it("marks an in-flight query superseded when a newer query starts", () => {
    const first = tracedHandle("first");
    const second = tracedHandle("second");
    const beginTrace = vi.fn()
      .mockReturnValueOnce(first.handle)
      .mockReturnValueOnce(second.handle);
    const runtime = createSearchInteractionRuntime({ beginTrace });
    const firstGeneration = runtime.startQuery("text", "old");
    void runtime.trackQuery({
      generation: firstGeneration,
      request: new Promise(() => undefined),
      apply: vi.fn(),
    });

    runtime.startQuery("text", "new");

    expect(first.phase.finish).toHaveBeenCalledWith("superseded", "newer-query");
    expect(first.finish).toHaveBeenCalledWith("superseded");
  });
});

function tracedHandle(id: string) {
  const phase = { finish: vi.fn() };
  const finish = vi.fn();
  return {
    handle: { id, startPhase: vi.fn(() => phase), finish },
    phase,
    finish,
  };
}
