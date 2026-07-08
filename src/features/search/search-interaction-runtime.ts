export type SearchInteractionKind = "searchEverywhere" | "text";

export type SearchInteractionRuntimeOptions = {
  cancel?: (kind: SearchInteractionKind, generation: number) => void;
};

export type SearchInteractionRuntime = ReturnType<typeof createSearchInteractionRuntime>;

export function createSearchInteractionRuntime(options: SearchInteractionRuntimeOptions = {}) {
  let queryGeneration = 0;
  let previewGeneration = 0;
  let activeQuery: { kind: SearchInteractionKind; generation: number } | null = null;

  function cancelActive() {
    if (!activeQuery) return;
    options.cancel?.(activeQuery.kind, activeQuery.generation);
    activeQuery = null;
  }

  return {
    startQuery(kind: SearchInteractionKind) {
      cancelActive();
      queryGeneration += 1;
      activeQuery = { kind, generation: queryGeneration };
      return queryGeneration;
    },
    invalidateForeground({ cancelActive: shouldCancel = true } = {}) {
      const currentActive = activeQuery;
      queryGeneration += 1;
      previewGeneration += 1;
      activeQuery = null;
      if (shouldCancel && currentActive) {
        options.cancel?.(currentActive.kind, currentActive.generation);
      }
      return queryGeneration;
    },
    startPreview() {
      previewGeneration += 1;
      return previewGeneration;
    },
    invalidatePreview() {
      previewGeneration += 1;
      return previewGeneration;
    },
    isCurrentQuery(generation: number) {
      return queryGeneration === generation;
    },
    isCurrentPreview(generation: number) {
      return previewGeneration === generation;
    },
    finishQuery(generation: number) {
      if (activeQuery?.generation === generation) {
        activeQuery = null;
      }
    },
    getCurrentQueryGeneration() {
      return queryGeneration;
    },
    cancelActive,
  };
}
