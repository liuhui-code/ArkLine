import {
  beginInteractionTrace,
  type InteractionTraceHandle,
  type InteractionTracePhaseHandle,
} from "@/features/performance/interaction-trace-store";

export type SearchInteractionKind = "searchEverywhere" | "text";

export type SearchInteractionRuntimeOptions = {
  cancel?: (kind: SearchInteractionKind, generation: number) => void;
  onError?: (error: unknown, generation: number) => void;
  beginTrace?: typeof beginInteractionTrace;
  scheduleVisibleCommit?: (callback: () => void) => () => void;
};

export type SearchInteractionRuntime = ReturnType<typeof createSearchInteractionRuntime>;

export type SearchQueryRunOptions<T> = {
  kind: SearchInteractionKind;
  request: (generation: number) => Promise<T>;
  apply: (result: T, generation: number) => void;
};

export type SearchQueryTrackOptions<T> = {
  generation: number;
  request: Promise<T>;
  apply: (result: T, generation: number) => void;
};

export function createSearchInteractionRuntime(options: SearchInteractionRuntimeOptions = {}) {
  let queryGeneration = 0;
  let previewGeneration = 0;
  let activeQuery: {
    kind: SearchInteractionKind;
    generation: number;
    label: string;
    trace?: InteractionTraceHandle;
    queryPhase?: InteractionTracePhaseHandle;
  } | null = null;

  function cancelActive(status: "cancelled" | "superseded" = "cancelled", detail = "foreground-invalidated") {
    if (!activeQuery) return;
    options.cancel?.(activeQuery.kind, activeQuery.generation);
    activeQuery.queryPhase?.finish(status, detail);
    activeQuery.trace?.finish(status);
    activeQuery = null;
  }

  function startQuery(kind: SearchInteractionKind, label: string = kind) {
    cancelActive("superseded", "newer-query");
    queryGeneration += 1;
    activeQuery = { kind, generation: queryGeneration, label };
    return queryGeneration;
  }

  function invalidateForeground({ cancelActive: shouldCancel = true } = {}) {
    const currentActive = activeQuery;
    queryGeneration += 1;
    previewGeneration += 1;
    activeQuery = null;
    if (shouldCancel && currentActive) {
      options.cancel?.(currentActive.kind, currentActive.generation);
    }
    currentActive?.queryPhase?.finish("cancelled", "foreground-invalidated");
    currentActive?.trace?.finish("cancelled");
    return queryGeneration;
  }

  function startPreview() {
    previewGeneration += 1;
    return previewGeneration;
  }

  function invalidatePreview() {
    previewGeneration += 1;
    return previewGeneration;
  }

  function isCurrentQuery(generation: number) {
    return queryGeneration === generation;
  }

  function isCurrentPreview(generation: number) {
    return previewGeneration === generation;
  }

  function finishQuery(generation: number) {
    if (activeQuery?.generation === generation) {
      activeQuery = null;
    }
  }

  function trackQuery<T>({ generation, request, apply }: SearchQueryTrackOptions<T>) {
    const tracked = activeQuery?.generation === generation ? activeQuery : null;
    const trace = tracked?.trace ?? options.beginTrace?.(
      tracked?.kind ?? "searchEverywhere",
      tracked?.label ?? `generation-${generation}`,
      generation,
    ) ?? beginInteractionTrace(
      tracked?.kind ?? "searchEverywhere",
      tracked?.label ?? `generation-${generation}`,
      generation,
    );
    const queryPhase = trace.startPhase("queryBroker");
    if (tracked) {
      tracked.trace = trace;
      tracked.queryPhase = queryPhase;
    }
    return request
      .then((result) => {
        if (!isCurrentQuery(generation)) {
          queryPhase.finish("superseded", "stale-result");
          trace.finish("superseded");
          return;
        }
        queryPhase.finish();
        const applyPhase = trace.startPhase("applyResults");
        apply(result, generation);
        applyPhase.finish();
        const visiblePhase = trace.startPhase("visibleCommit");
        scheduleVisibleCommit(options.scheduleVisibleCommit, () => {
          visiblePhase.finish();
          trace.finish("ok");
        });
      })
      .catch((error) => {
        const expected = isExpectedSearchInterruption(error);
        queryPhase.finish(expected ? "cancelled" : "error", errorMessage(error));
        trace.finish(expected ? "cancelled" : "error");
        if (
          isCurrentQuery(generation)
          && !expected
        ) {
          options.onError?.(error, generation);
        }
      })
      .finally(() => finishQuery(generation));
  }

  function runQuery<T>({ kind, request, apply }: SearchQueryRunOptions<T>) {
    const generation = startQuery(kind);
    return trackQuery({ generation, request: request(generation), apply });
  }

  return {
    startQuery,
    invalidateForeground,
    startPreview,
    invalidatePreview,
    isCurrentQuery,
    isCurrentPreview,
    finishQuery,
    trackQuery,
    runQuery,
    getCurrentQueryGeneration() {
      return queryGeneration;
    },
    cancelActive,
  };
}

function scheduleVisibleCommit(
  schedule: SearchInteractionRuntimeOptions["scheduleVisibleCommit"],
  callback: () => void,
) {
  if (schedule) {
    schedule(callback);
    return;
  }
  if (typeof window !== "undefined" && window.requestAnimationFrame) {
    window.requestAnimationFrame(() => window.requestAnimationFrame(callback));
    return;
  }
  queueMicrotask(callback);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isExpectedSearchInterruption(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Workspace query superseded")
    || message.includes("Workspace query deadline exceeded");
}
