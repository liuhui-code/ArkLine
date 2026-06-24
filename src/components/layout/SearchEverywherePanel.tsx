import type {
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";

type SearchEverywherePanelProps = {
  options: WorkspaceTextSearchOptions;
  query: string;
  result: WorkspaceTextSearchResult;
  selectedIndex: number;
  onChangeQuery: (value: string) => void;
  onMoveSelection: (direction: 1 | -1) => void;
  onOpenSelected: () => void;
  onSelectResult: (index: number) => void;
  onOpenResult: (result: WorkspaceTextSearchMatch) => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onCloseOverlay: () => void;
};

export function SearchEverywherePanel({
  options,
  query,
  result,
  selectedIndex,
  onChangeQuery,
  onMoveSelection,
  onOpenSelected,
  onSelectResult,
  onOpenResult,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onCloseOverlay,
}: SearchEverywherePanelProps) {
  const selected = result.matches[selectedIndex] ?? null;
  const regexMode = result.query.kind === "regex" || result.query.kind === "invalid";
  const description =
    regexMode ? "Regular expression search across the workspace"
    : "Text search across the workspace";

  return (
    <div className="search-everywhere">
      <div className="search-everywhere__header">
        <div>
          <strong>Search Everywhere</strong>
          <span>{description}</span>
        </div>
        <button
          type="button"
          className="search-everywhere__close"
          aria-label="Close Search Everywhere"
          onClick={onCloseOverlay}
        >
          ×
        </button>
      </div>
      <div className="search-everywhere__toolbar">
        <input
          aria-label="Search Everywhere Query"
          autoFocus
          className="panel-input"
          value={query}
          placeholder="Search code, or use /regex/"
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              onMoveSelection(1);
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              onMoveSelection(-1);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              onOpenSelected();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCloseOverlay();
            }
          }}
        />
        <div className="search-everywhere__controls" aria-label="Search Everywhere Options">
          <button
            type="button"
            className={`toolbar__button search-everywhere__toggle${options.caseSensitive ? " search-everywhere__toggle--active" : ""}`}
            aria-pressed={options.caseSensitive}
            disabled={regexMode}
            onClick={onToggleCaseSensitive}
          >
            Aa
          </button>
          <button
            type="button"
            className={`toolbar__button search-everywhere__toggle${options.wholeWord ? " search-everywhere__toggle--active" : ""}`}
            aria-pressed={options.wholeWord}
            disabled={regexMode}
            onClick={onToggleWholeWord}
          >
            W
          </button>
        </div>
      </div>
      {result.query.kind === "invalid" ? (
        <div className="search-everywhere__error" role="status">
          Invalid regular expression: {result.query.message}
        </div>
      ) : null}
      <div className="search-everywhere__body">
        <div className="search-results" role="list" aria-label="Search Everywhere Results">
          {result.matches.map((item, index) => (
            <button
              key={`${item.path}:${item.line}:${item.column}`}
              type="button"
              className={`search-result${index === selectedIndex ? " search-result--selected" : ""}`}
              aria-selected={index === selectedIndex}
              onMouseEnter={() => onSelectResult(index)}
              onClick={() => onOpenResult(item)}
            >
              <span className="search-result__title">{item.fileName}</span>
              <span className="search-result__meta">{item.relativePath}:{item.line}</span>
              <span className="search-result__preview">{item.summary}</span>
            </button>
          ))}
          {result.query.kind !== "invalid" && result.matches.length === 0 ? (
            <div className="search-everywhere__empty">No matches</div>
          ) : null}
        </div>
        <div className="search-everywhere__preview" aria-label="Search Everywhere Preview">
          {selected ? <SearchPreview match={selected} /> : <div className="search-everywhere__empty">Select a result to preview</div>}
        </div>
      </div>
    </div>
  );
}

function SearchPreview({ match }: { match: WorkspaceTextSearchMatch }) {
  const hitLine = highlightPreview(match.preview, match.previewStart, match.previewEnd);

  return (
    <>
      <div className="search-everywhere__preview-header">
        <strong>{match.fileName}</strong>
        <span>{match.relativePath}:{match.line}:{match.column}</span>
      </div>
      <pre className="search-everywhere__preview-code">
        {match.contextBefore.map((line) => (
          <div key={`before:${line.line}`} className="search-everywhere__preview-line">
            <span className="search-everywhere__preview-number">{line.line}</span>
            <span>{line.text}</span>
          </div>
        ))}
        <div className="search-everywhere__preview-line search-everywhere__preview-line--hit">
          <span className="search-everywhere__preview-number">{match.line}</span>
          <span>{hitLine}</span>
        </div>
        {match.contextAfter.map((line) => (
          <div key={`after:${line.line}`} className="search-everywhere__preview-line">
            <span className="search-everywhere__preview-number">{line.line}</span>
            <span>{line.text}</span>
          </div>
        ))}
      </pre>
    </>
  );
}

function highlightPreview(line: string, start: number, end: number) {
  return (
    <>
      {line.slice(0, start)}
      <mark className="search-everywhere__preview-hit">{line.slice(start, end)}</mark>
      {line.slice(end)}
    </>
  );
}
