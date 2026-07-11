export type SearchInteractionKind = "searchEverywhere" | "text";

export type SearchInteractionRuntimeOptions = {
  cancel?: (kind: SearchInteractionKind, generation: number) => void;
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
  let activeQuery: { kind: SearchInteractionKind; generation: number } | null = null;

  function cancelActive() {
    if (!activeQuery) return;
    options.cancel?.(activeQuery.kind, activeQuery.generation);
    activeQuery = null;
  }

  function startQuery(kind: SearchInteractionKind) {
    cancelActive();
    queryGeneration += 1;
    activeQuery = { kind, generation: queryGeneration };
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
    return request
      .then((result) => {
        if (isCurrentQuery(generation)) {
          apply(result, generation);
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
