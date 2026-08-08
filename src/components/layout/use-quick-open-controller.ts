import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexQueryEnvelope } from "@/features/workspace/workspace-index-api-types";
import { beginInteractionTrace } from "@/features/performance/interaction-trace-store";

type QuickOpenResult = { path: string };

export type UseQuickOpenControllerOptions = {
  active: boolean;
  rootPath: string | null;
  query: string;
  localResults: QuickOpenResult[];
  queryLocal?: (query: string) => QuickOpenResult[];
  queryWorkspace?: (
    rootPath: string,
    query: string,
    limit: number,
  ) => Promise<SearchCandidate[]>;
  queryWorkspaceWithReadiness?: (
    rootPath: string,
    query: string,
    scope: "files",
    limit: number,
    cursor: number | null,
    context: undefined,
    generation: number,
    deadlineMs: number,
    queryLane: "quickOpen",
  ) => Promise<WorkspaceIndexQueryEnvelope<SearchCandidate>>;
  cancelWorkspaceSearch?: (rootPath: string, kind: string, generation: number) => Promise<void>;
  onError?: (message: string) => void;
};

const QUICK_OPEN_LIMIT = 20;
const QUICK_OPEN_DEBOUNCE_MS = 40;
const QUICK_OPEN_DEADLINE_MS = 1_000;
const CONFIRMED_QUERY_CACHE_LIMIT = 50;

export function useQuickOpenController({
  active,
  rootPath,
  query,
  localResults,
  queryLocal,
  queryWorkspace,
  queryWorkspaceWithReadiness,
  cancelWorkspaceSearch,
  onError,
}: UseQuickOpenControllerOptions) {
  const [remoteState, setRemoteState] = useState<{
    rootPath: string | null;
    query: string;
    results: QuickOpenResult[];
    fallbackToLocal: boolean;
  }>({ rootPath: null, query: "", results: [], fallbackToLocal: false });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestGenerationRef = useRef(0);
  const confirmedResultsRef = useRef(new Map<string, QuickOpenResult[]>());
  const queryLocalRef = useRef(queryLocal);
  queryLocalRef.current = queryLocal;
  const trimmedQuery = query.trim();
  const persistentQueryAvailable = Boolean(queryWorkspaceWithReadiness || queryWorkspace);

  useEffect(() => {
    setSelectedIndex(0);
  }, [active, trimmedQuery]);

  useEffect(() => {
    if (!active || !rootPath || !persistentQueryAvailable) {
      requestGenerationRef.current += 1;
      return;
    }

    const generation = ++requestGenerationRef.current;
    let requestStarted = false;
    let requestSettled = false;
    const trace = beginInteractionTrace("quickOpen", trimmedQuery, generation);
    const debouncePhase = trace.startPhase("debounce");
    const timeout = window.setTimeout(() => {
      requestStarted = true;
      debouncePhase.finish();
      const queryPhase = trace.startPhase("queryBroker");
      const request = queryWorkspaceWithReadiness
        ? queryWorkspaceWithReadiness(
          rootPath,
          trimmedQuery,
          "files",
          QUICK_OPEN_LIMIT,
          null,
          undefined,
          generation,
          QUICK_OPEN_DEADLINE_MS,
          "quickOpen",
        ).then((envelope) => ({
          candidates: envelope.items,
          fallbackToLocal: envelope.items.length === 0 && envelope.readiness.state !== "ready",
          readiness: envelope.readiness.state,
        }))
        : queryWorkspace!(rootPath, trimmedQuery, QUICK_OPEN_LIMIT).then((candidates) => ({
          candidates,
          fallbackToLocal: false,
          readiness: "legacy",
        }));
      void request
        .then(({ candidates, fallbackToLocal, readiness }) => {
          requestSettled = true;
          queryPhase.finish("ok", `results=${candidates.length}; readiness=${readiness}`);
          if (generation !== requestGenerationRef.current) {
            trace.finish("superseded");
            return;
          }
          const publishPhase = trace.startPhase("publishResults");
          const queryKey = quickOpenQueryKey(rootPath, trimmedQuery);
          const results = candidates.flatMap((candidate) =>
            candidate.path ? [{ path: candidate.path }] : []);
          if (results.length > 0) {
            rememberConfirmedResults(confirmedResultsRef.current, queryKey, results);
          }
          setRemoteState({
            rootPath,
            query: trimmedQuery,
            results: results.length > 0
              ? results
              : confirmedResultsRef.current.get(queryKey) ?? [],
            fallbackToLocal,
          });
          publishPhase.finish();
          trace.finish();
        })
        .catch((error) => {
          requestSettled = true;
          queryPhase.finish("error", error instanceof Error ? error.message : String(error));
          if (generation !== requestGenerationRef.current) {
            trace.finish("superseded");
            return;
          }
          trace.finish("error");
          onError?.(
            `Quick Open failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }, QUICK_OPEN_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
      if (!requestStarted) debouncePhase.finish("cancelled");
      if (requestStarted && !requestSettled && cancelWorkspaceSearch) {
        void cancelWorkspaceSearch(rootPath, "quickOpen", generation).catch(() => undefined);
      }
      if (!requestSettled) trace.finish("cancelled");
    };
  }, [active, cancelWorkspaceSearch, onError, persistentQueryAvailable, queryWorkspace, queryWorkspaceWithReadiness, rootPath, trimmedQuery]);

  const results = useMemo(() => {
    if (!active) return [];
    if (persistentQueryAvailable && rootPath) {
      if (
        remoteState.rootPath === rootPath
        && remoteState.query === trimmedQuery
      ) {
        if (remoteState.fallbackToLocal) {
          const localFallback = queryLocalRef.current?.(trimmedQuery) ?? localResults;
          return localFallback.length > 0 ? localFallback : remoteState.results;
        }
        return remoteState.results;
      }
      if (remoteState.rootPath === rootPath && remoteState.fallbackToLocal) {
        return queryLocalRef.current?.(trimmedQuery) ?? localResults;
      }
      return [];
    }
    return localResults;
  }, [active, localResults, persistentQueryAvailable, remoteState, rootPath, trimmedQuery]);

  useEffect(() => {
    if (results.length === 0) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, results.length - 1));
  }, [results.length]);

  function moveSelection(direction: 1 | -1) {
    if (results.length === 0) return;
    setSelectedIndex((current) =>
      (current + direction + results.length) % results.length);
  }

  return {
    results,
    selectedIndex,
    setSelectedIndex,
    moveSelection,
    selectedResult: results[selectedIndex] ?? null,
  };
}

function quickOpenQueryKey(rootPath: string, query: string) {
  return `${rootPath}\u0000${query}`;
}

function rememberConfirmedResults(
  cache: Map<string, QuickOpenResult[]>,
  key: string,
  results: QuickOpenResult[],
) {
  cache.delete(key);
  cache.set(key, results);
  while (cache.size > CONFIRMED_QUERY_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    cache.delete(oldestKey);
  }
}
