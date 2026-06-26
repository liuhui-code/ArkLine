import type {
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";

type SearchEverywherePanelProps = {
  mode: SearchEverywhereMode;
  options: WorkspaceTextSearchOptions;
  query: string;
  replaceQuery: string;
  result: WorkspaceTextSearchResult;
  selectedIndex: number;
  partialNotice?: string | null;
  onChangeQuery: (value: string) => void;
  onChangeReplaceQuery: (value: string) => void;
  onMoveSelection: (direction: 1 | -1) => void;
  onOpenSelected: () => void;
  onSelectResult: (index: number) => void;
  onOpenResult: (result: WorkspaceTextSearchMatch) => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onCloseOverlay: () => void;
};

export type SearchEverywhereMode = "searchEverywhere" | "find" | "replace";

export function SearchEverywherePanel({
  mode,
  options,
  query,
  replaceQuery,
  result,
  selectedIndex,
  partialNotice,
  onChangeQuery,
  onChangeReplaceQuery,
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
  const presentation = searchModePresentation(mode, regexMode);
  const groups = groupSearchMatches(result.matches);
  const resultsLabel = `${presentation.title} Results`;

  return (
    <div className="search-everywhere">
      <div className="search-everywhere__header">
        <div>
          <strong>{presentation.title}</strong>
          <span>{presentation.description}</span>
        </div>
        <button
          type="button"
          className="search-everywhere__close"
          aria-label={`Close ${presentation.title}`}
          onClick={onCloseOverlay}
        >
          ×
        </button>
      </div>
      <div className="search-everywhere__toolbar">
        <input
          aria-label={`${presentation.title} Query`}
          autoFocus
          className="panel-input"
          value={query}
          placeholder={presentation.searchPlaceholder}
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
        {mode === "replace" ? (
          <input
            aria-label="Replace With"
            className="panel-input search-everywhere__replace-input"
            value={replaceQuery}
            placeholder="Replace with"
            onChange={(event) => onChangeReplaceQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onCloseOverlay();
              }
            }}
          />
        ) : null}
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
      {partialNotice ? <div className="search-everywhere__error" role="status">{partialNotice}</div> : null}
      <div className="search-everywhere__body">
        <div className="search-results search-results--grouped" role="list" aria-label={resultsLabel}>
          {groups.map((group) => (
            <section key={group.path} className="search-result-group" aria-label={`${group.relativePath} ${group.matches.length} matches`}>
              <div className="search-result-group__header">
                <div>
                  <span className="search-result-group__file">{group.fileName}</span>
                  <span className="search-result-group__path">{group.relativePath}</span>
                </div>
                <span className="search-result-group__count">{group.matches.length}</span>
              </div>
              <div className="search-result-group__matches">
                {group.matches.map(({ item, index }) => (
                  <button
                    key={`${item.path}:${item.line}:${item.column}`}
                    type="button"
                    className={`search-result search-result--match${index === selectedIndex ? " search-result--selected" : ""}`}
                    aria-label={`${item.relativePath}:${item.line}:${item.column} ${item.summary}`}
                    aria-selected={index === selectedIndex}
                    onMouseEnter={() => onSelectResult(index)}
                    onClick={() => onOpenResult(item)}
                  >
                    <span className="search-result__location">{item.line}:{item.column}</span>
                    <span className="search-result__preview">{item.summary}</span>
                  </button>
                ))}
              </div>
            </section>
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

function searchModePresentation(mode: SearchEverywhereMode, regexMode: boolean) {
  const searchKind = regexMode ? "Regular expression" : "Text";

  if (mode === "find") {
    return {
      title: "Find in Files",
      description: `${searchKind} search across the workspace`,
      searchPlaceholder: "Find in files, or use /regex/",
    };
  }

  if (mode === "replace") {
    return {
      title: "Replace in Files",
      description: `${searchKind} search with replacement preview`,
      searchPlaceholder: "Find text to replace, or use /regex/",
    };
  }

  return {
    title: "Search Everywhere",
    description: `${searchKind} search across the workspace`,
    searchPlaceholder: "Search code, or use /regex/",
  };
}

function groupSearchMatches(matches: WorkspaceTextSearchMatch[]) {
  const groups: {
    path: string;
    fileName: string;
    relativePath: string;
    matches: { item: WorkspaceTextSearchMatch; index: number }[];
  }[] = [];
  const groupByPath = new Map<string, (typeof groups)[number]>();

  matches.forEach((item, index) => {
    let group = groupByPath.get(item.path);
    if (!group) {
      group = {
        path: item.path,
        fileName: item.fileName,
        relativePath: item.relativePath,
        matches: [],
      };
      groups.push(group);
      groupByPath.set(item.path, group);
    }

    group.matches.push({ item, index });
  });

  return groups;
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
