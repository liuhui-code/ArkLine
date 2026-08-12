import { useCallback, useEffect, useRef } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";

export type DeferredQueryMode = SearchEverywhereMode | "quickOpen";

const INPUT_COMMIT_DEBOUNCE_MS: Record<DeferredQueryMode, number> = {
  // Keep the DOM input local while a user is typing. A slightly wider quiet
  // window prevents slow WebView automation and IME composition from issuing
  // one root-shell query update for each character.
  quickOpen: 120,
  searchEverywhere: 120,
  find: 120,
  replace: 120,
};

export function useSearchSessionInput(
  committedQuery: string,
  mode: DeferredQueryMode,
  onCommit: (query: string) => void,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draftQueryRef = useRef(committedQuery);
  const committedQueryRef = useRef(committedQuery);
  const onCommitRef = useRef(onCommit);
  const timeoutRef = useRef<number | null>(null);

  committedQueryRef.current = committedQuery;
  onCommitRef.current = onCommit;

  useEffect(() => {
    draftQueryRef.current = committedQuery;
    if (inputRef.current && inputRef.current.value !== committedQuery) {
      inputRef.current.value = committedQuery;
    }
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [committedQuery, mode]);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, [mode]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const updateDraftQuery = useCallback((query: string) => {
    draftQueryRef.current = query;
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
    }
    if (query === committedQueryRef.current) {
      timeoutRef.current = null;
      return;
    }
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
      onCommitRef.current(draftQueryRef.current);
    }, INPUT_COMMIT_DEBOUNCE_MS[mode]);
  }, [mode]);

  const flushDraftQuery = useCallback(() => {
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    const query = draftQueryRef.current;
    if (query === committedQueryRef.current) return false;
    onCommitRef.current(query);
    return true;
  }, []);

  return { inputRef, updateDraftQuery, flushDraftQuery };
}
