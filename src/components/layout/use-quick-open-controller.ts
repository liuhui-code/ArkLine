import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";

type QuickOpenResult = { path: string };

export type UseQuickOpenControllerOptions = {
  active: boolean;
  rootPath: string | null;
  query: string;
  localResults: QuickOpenResult[];
  queryWorkspace?: (
    rootPath: string,
    query: string,
    limit: number,
  ) => Promise<SearchCandidate[]>;
  onError?: (message: string) => void;
};

const QUICK_OPEN_LIMIT = 20;
const QUICK_OPEN_DEBOUNCE_MS = 40;

export function useQuickOpenController({
  active,
  rootPath,
  query,
  localResults,
  queryWorkspace,
  onError,
}: UseQuickOpenControllerOptions) {
  const [remoteState, setRemoteState] = useState<{
    rootPath: string | null;
    query: string;
    results: QuickOpenResult[];
  }>({ rootPath: null, query: "", results: [] });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const requestGenerationRef = useRef(0);
  const trimmedQuery = query.trim();

  useEffect(() => {
    setSelectedIndex(0);
  }, [active, trimmedQuery]);

  useEffect(() => {
    if (!active || !rootPath || !trimmedQuery || !queryWorkspace) {
      requestGenerationRef.current += 1;
      return;
    }

    const generation = ++requestGenerationRef.current;
    const timeout = window.setTimeout(() => {
      void queryWorkspace(rootPath, trimmedQuery, QUICK_OPEN_LIMIT)
        .then((candidates) => {
          if (generation !== requestGenerationRef.current) return;
          setRemoteState({
            rootPath,
            query: trimmedQuery,
            results: candidates.flatMap((candidate) =>
              candidate.path ? [{ path: candidate.path }] : []),
          });
        })
        .catch((error) => {
          if (generation !== requestGenerationRef.current) return;
          onError?.(
            `Quick Open failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }, QUICK_OPEN_DEBOUNCE_MS);

    return () => window.clearTimeout(timeout);
  }, [active, onError, queryWorkspace, rootPath, trimmedQuery]);

  const results = useMemo(() => {
    if (!active) return [];
    if (
      remoteState.rootPath === rootPath
      && remoteState.query === trimmedQuery
    ) return remoteState.results;
    return localResults;
  }, [active, localResults, remoteState, rootPath, trimmedQuery]);

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
