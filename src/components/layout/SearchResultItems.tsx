import type {
  WorkspaceTextSearchMatch,
} from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { MouseEvent as ReactMouseEvent } from "react";

type ResultRef = (node: HTMLButtonElement | null) => void;

type SearchCandidateResultItemProps = {
  item: SearchCandidate;
  index: number;
  selected: boolean;
  query: string;
  resultRef: ResultRef;
  onSelect: (index: number) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

type TextSearchResultItemProps = {
  item: WorkspaceTextSearchMatch;
  index: number;
  selected: boolean;
  query: string;
  resultRef: ResultRef;
  onSelect: (index: number) => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
};

export function SearchCandidateResultItem({
  item,
  index,
  selected,
  query,
  resultRef,
  onSelect,
  onMouseDown,
  onClick,
  onContextMenu,
}: SearchCandidateResultItemProps) {
  return (
    <button
      ref={resultRef}
      type="button"
      className={`search-result search-result--match${selected ? " search-result--selected" : ""}`}
      aria-label={`${item.source} ${item.title} ${item.subtitle}`}
      aria-selected={selected}
      onMouseEnter={() => onSelect(index)}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className={`search-result__kind-badge search-result__kind-badge--${item.source}`}>
        {candidateBadge(item)}
      </span>
      <span className="search-result__candidate-main">
        <span className="search-result__title">
          {highlightSearchText(item.title, query)}
        </span>
        <span className="search-result__candidate-path">{item.subtitle}</span>
      </span>
      <span className="search-result__candidate-meta">
        {candidateLocation(item)}
      </span>
    </button>
  );
}

export function TextSearchResultItem({
  item,
  index,
  selected,
  query,
  resultRef,
  onSelect,
  onMouseDown,
  onClick,
  onContextMenu,
}: TextSearchResultItemProps) {
  const contextBefore = selected ? item.contextBefore.slice(-1) : [];
  const contextAfter = selected ? item.contextAfter.slice(0, 1) : [];
  const hitText = selected ? item.preview : item.summary;

  return (
    <button
      ref={resultRef}
      type="button"
      className={`search-result search-result--match${selected ? " search-result--selected" : ""}`}
      aria-label={`${item.relativePath}:${item.line}:${item.column} ${item.summary}`}
      aria-selected={selected}
      onMouseEnter={() => onSelect(index)}
      onMouseDown={onMouseDown}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {contextBefore.map((line) => (
        <CodeContextLine key={`before:${line.line}`} line={line.line} text={line.text} />
      ))}
      <span className="search-result__code-hit">
        <span className="search-result__line-number">{item.line}</span>
        <span className="search-result__code-text">
          {highlightSearchText(hitText, query)}
        </span>
      </span>
      {contextAfter.map((line) => (
        <CodeContextLine key={`after:${line.line}`} line={line.line} text={line.text} />
      ))}
    </button>
  );
}

function CodeContextLine({ line, text }: { line: number; text: string }) {
  return (
    <span className="search-result__context-line" aria-hidden="true">
      <span className="search-result__line-number">{line}</span>
      <span className="search-result__context-text">{text}</span>
    </span>
  );
}

function highlightSearchText(text: string, query: string) {
  const needle = normalizeHighlightNeedle(query);
  if (!needle) return text;
  const index = text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  if (index < 0) return text;
  const end = index + needle.length;
  return (
    <>
      {text.slice(0, index)}
      <mark className="search-result__highlight">{text.slice(index, end)}</mark>
      {text.slice(end)}
    </>
  );
}

function normalizeHighlightNeedle(query: string) {
  const trimmed = query.trim();
  if (!trimmed) return "";
  if (trimmed.length > 2 && trimmed.startsWith("/") && trimmed.endsWith("/")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function candidateLocation(item: SearchCandidate) {
  if (item.line != null && item.column != null) {
    return `${item.line}:${item.column}`;
  }
  return item.kind;
}

function candidateBadge(item: SearchCandidate) {
  if (item.source === "class") return "C";
  if (item.source === "symbol") return "M";
  if (item.source === "file") return "F";
  if (item.source === "api") return "A";
  if (item.source === "sdk") return "S";
  if (item.source === "action") return "Go";
  return "T";
}
