import { useEffect, useRef, useState } from "react";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";

const INPUT_COMMIT_DEBOUNCE_MS: Record<SearchEverywhereMode, number> = {
  searchEverywhere: 40,
  find: 100,
  replace: 100,
};

export function useSearchSessionInput(
  committedQuery: string,
  mode: SearchEverywhereMode,
  onCommit: (query: string) => void,
) {
  const [draftQuery, setDraftQuery] = useState(committedQuery);
  const onCommitRef = useRef(onCommit);

  onCommitRef.current = onCommit;

  useEffect(() => {
    setDraftQuery(committedQuery);
  }, [committedQuery, mode]);

  useEffect(() => {
    if (draftQuery === committedQuery) {
      return;
    }
    const timeout = window.setTimeout(
      () => onCommitRef.current(draftQuery),
      INPUT_COMMIT_DEBOUNCE_MS[mode],
    );
    return () => window.clearTimeout(timeout);
  }, [committedQuery, draftQuery, mode]);

  return { draftQuery, setDraftQuery };
}
