import { useCallback, useEffect, useRef, type KeyboardEvent } from "react";
import { englishQueryInputProps } from "@/components/layout/query-input-props";
import { useSearchSessionInput } from "@/components/layout/use-search-session-input";

type QuickOpenResult = { path: string };

export type QuickOpenPanelProps = {
  query: string;
  results: QuickOpenResult[];
  selectedIndex: number;
  partialNotice?: string | null;
  onChangeQuery: (value: string) => void;
  onMoveSelection: (direction: 1 | -1) => void;
  onSelectResult: (index: number) => void;
  onOpenResult: (path: string) => void;
  onClose: () => void;
};

export function QuickOpenPanel({
  query,
  results,
  selectedIndex,
  partialNotice,
  onChangeQuery,
  onMoveSelection,
  onSelectResult,
  onOpenResult,
  onClose,
}: QuickOpenPanelProps) {
  const resultRefs = useRef(new Map<number, HTMLButtonElement>());
  const { inputRef, updateDraftQuery, flushDraftQuery } = useSearchSessionInput(
    query,
    "quickOpen",
    onChangeQuery,
  );

  useEffect(() => {
    const selectedResult = resultRefs.current.get(selectedIndex);
    if (typeof selectedResult?.scrollIntoView === "function") {
      selectedResult.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const registerResultRef = useCallback(
    (index: number, node: HTMLButtonElement | null) => {
      if (node) resultRefs.current.set(index, node);
      else resultRefs.current.delete(index);
    },
    [],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      onMoveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (flushDraftQuery()) return;
      const selected = results[selectedIndex];
      if (selected) onOpenResult(selected.path);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        aria-label="Quick Open Query"
        autoFocus
        className="panel-input"
        {...englishQueryInputProps}
        defaultValue={query}
        placeholder="Type a filename or path"
        onChange={(event) => updateDraftQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {partialNotice ? <div className="palette-empty" role="status">{partialNotice}</div> : null}
      <div
        className="search-results"
        role="list"
        aria-label="Quick Open Results"
        data-query={query}
      >
        {results.map((result, index) => (
          <button
            key={result.path}
            ref={(node) => registerResultRef(index, node)}
            type="button"
            aria-selected={index === selectedIndex}
            className={`search-result${index === selectedIndex ? " search-result--selected" : ""}`}
            onMouseMove={() => onSelectResult(index)}
            onClick={() => onOpenResult(result.path)}
          >
            {result.path}
          </button>
        ))}
        {results.length === 0 ? <div className="palette-empty">No files found</div> : null}
      </div>
    </>
  );
}
