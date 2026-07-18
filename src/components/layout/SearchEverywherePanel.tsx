import { ContextMenu, type ContextMenuState } from "@/components/layout/ContextMenu";
import { englishQueryInputProps } from "@/components/layout/query-input-props";
import { SearchCandidateResultItem, TextSearchResultItem } from "@/components/layout/SearchResultItems";
import { buildSearchEverywherePanelViewModel } from "@/components/layout/search-everywhere-panel-model";
import { SearchPreviewPane } from "@/components/layout/SearchPreviewPane";
import { SearchSessionQueryInput } from "@/components/layout/SearchSessionQueryInput";
import { useLatestCallback } from "@/components/layout/use-latest-callback";
import type {
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type WheelEvent } from "react";

type SearchEverywherePanelProps = {
  mode: SearchEverywhereMode;
  scope: WorkspaceIndexQueryScope;
  options: WorkspaceTextSearchOptions;
  query: string;
  replaceQuery: string;
  result: WorkspaceTextSearchResult;
  candidates: SearchCandidate[];
  selectedIndex: number;
  selectedPreviewContent: string | null;
  canLoadMore: boolean;
  pageLoading: boolean;
  partialNotice?: string | null;
  onChangeQuery: (value: string) => void;
  onDraftQueryChange: (value: string) => void;
  onChangeScope: (scope: WorkspaceIndexQueryScope) => void;
  onChangeReplaceQuery: (value: string) => void;
  onMoveSelection: (direction: 1 | -1) => void;
  onOpenSelected: () => void;
  onSelectResult: (index: number) => void;
  onOpenResult: (result: WorkspaceTextSearchMatch) => void;
  onOpenCandidate: (candidate: SearchCandidate) => void;
  onLoadMore: () => void;
  onToggleCaseSensitive: () => void;
  onToggleWholeWord: () => void;
  onCloseOverlay: () => void;
};

export type SearchEverywhereMode = "searchEverywhere" | "find" | "replace";

const SEARCH_EVERYWHERE_SCOPES: { scope: WorkspaceIndexQueryScope; label: string }[] = [
  { scope: "all", label: "All" },
  { scope: "files", label: "Files" },
  { scope: "classes", label: "Classes" },
  { scope: "symbols", label: "Symbols" },
  { scope: "api", label: "API" },
];

export function SearchEverywherePanel({
  mode,
  scope,
  options,
  query,
  replaceQuery,
  result,
  candidates,
  selectedIndex,
  selectedPreviewContent,
  canLoadMore,
  pageLoading,
  partialNotice,
  onChangeQuery,
  onDraftQueryChange,
  onChangeScope,
  onChangeReplaceQuery,
  onMoveSelection,
  onOpenSelected,
  onSelectResult,
  onOpenResult,
  onOpenCandidate,
  onLoadMore,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onCloseOverlay,
}: SearchEverywherePanelProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const viewModel = useMemo(
    () => buildSearchEverywherePanelViewModel({ mode, result, candidates, selectedIndex }),
    [candidates, mode, result, selectedIndex],
  );
  const { regexMode, presentation, textGroups, candidateGroups, resultsLabel, resultCount, selectedTextMatch } = viewModel;
  const pointerOpenRef = useRef(0);
  const resultRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    const selectedResult = resultRefs.current.get(selectedIndex);
    if (selectedResult && typeof selectedResult.scrollIntoView === "function") {
      selectedResult.scrollIntoView({ block: "center" });
    }
  }, [mode, resultCount, selectedIndex]);

  const registerResultRef = useCallback((index: number, node: HTMLButtonElement | null) => {
    if (node) resultRefs.current.set(index, node);
    else resultRefs.current.delete(index);
  }, []);

  const selectResult = useLatestCallback(onSelectResult);
  const handleCandidateMouseDown = useLatestCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    index: number,
    item: SearchCandidate,
  ) => openByMouseDown(event, index, () => onOpenCandidate(item)));
  const handleCandidateClick = useLatestCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    index: number,
    item: SearchCandidate,
  ) => openByClick(event, index, () => onOpenCandidate(item)));
  const handleCandidateContextMenu = useLatestCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    index: number,
    item: SearchCandidate,
  ) => openCandidateContextMenu(event, item, index));
  const handleTextMouseDown = useLatestCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    index: number,
    item: WorkspaceTextSearchMatch,
  ) => openByMouseDown(event, index, () => onOpenResult(item)));
  const handleTextClick = useLatestCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    index: number,
    item: WorkspaceTextSearchMatch,
  ) => openByClick(event, index, () => onOpenResult(item)));
  const handleTextContextMenu = useLatestCallback((
    event: ReactMouseEvent<HTMLButtonElement>,
    index: number,
    item: WorkspaceTextSearchMatch,
  ) => openTextResultContextMenu(event, item, index));

  function handlePanelKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowDown" && resultCount > 0) {
      event.preventDefault();
      event.stopPropagation();
      onMoveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" && resultCount > 0) {
      event.preventDefault();
      event.stopPropagation();
      onMoveSelection(-1);
      return;
    }

    if (event.key === "Enter" && resultCount > 0) {
      event.preventDefault();
      event.stopPropagation();
      onOpenSelected();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCloseOverlay();
    }
  }

  function handleResultsWheel(event: WheelEvent<HTMLDivElement>) {
    if (resultCount <= 0 || Math.abs(event.deltaY) < 12) return;
    onMoveSelection(event.deltaY > 0 ? 1 : -1);
  }

  function copyPath(path: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(path);
  }

  function openTextResultContextMenu(event: ReactMouseEvent<HTMLButtonElement>, item: WorkspaceTextSearchMatch, index: number) {
    event.preventDefault();
    event.stopPropagation();
    onSelectResult(index);
    setContextMenu({
      label: "Search result actions",
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "open", label: "Open", onSelect: () => onOpenResult(item) },
        { id: "copy-path", label: "Copy Path", separatorBefore: true, onSelect: () => copyPath(item.path) },
      ],
    });
  }

  function openCandidateContextMenu(event: ReactMouseEvent<HTMLButtonElement>, item: SearchCandidate, index: number) {
    event.preventDefault();
    event.stopPropagation();
    onSelectResult(index);
    setContextMenu({
      label: "Search result actions",
      x: event.clientX,
      y: event.clientY,
      items: [
        { id: "open", label: "Open", onSelect: () => onOpenCandidate(item) },
        {
          id: "copy-path",
          label: "Copy Path",
          disabled: !item.path,
          separatorBefore: true,
          onSelect: () => item.path ? copyPath(item.path) : undefined,
        },
      ],
    });
  }

  function openByMouseDown(event: ReactMouseEvent<HTMLButtonElement>, index: number, open: () => void) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); pointerOpenRef.current = Date.now(); onSelectResult(index); open();
  }
  function openByClick(event: ReactMouseEvent<HTMLButtonElement>, index: number, open: () => void) {
    event.stopPropagation(); if (Date.now() - pointerOpenRef.current < 500) return; onSelectResult(index); open();
  }

  return (
    <>
    <div className="search-everywhere" onKeyDownCapture={handlePanelKeyDownCapture}>
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
        <SearchSessionQueryInput
          label={`${presentation.title} Query`}
          mode={mode}
          query={query}
          placeholder={presentation.searchPlaceholder}
          onDraftChange={onDraftQueryChange}
          onCommit={onChangeQuery}
        />
        {mode === "replace" ? (
          <input
            aria-label="Replace With"
            className="panel-input search-everywhere__replace-input"
            {...englishQueryInputProps}
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
      {mode === "searchEverywhere" ? (
        <div className="search-everywhere__scopes" role="tablist" aria-label="Search Everywhere Categories">
          {SEARCH_EVERYWHERE_SCOPES.map((item) => (
            <button
              key={item.scope}
              type="button"
              role="tab"
              aria-selected={scope === item.scope}
              className={`search-everywhere__scope${scope === item.scope ? " search-everywhere__scope--active" : ""}`}
              onClick={() => onChangeScope(item.scope)}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
      {result.query.kind === "invalid" ? (
        <div className="search-everywhere__error" role="status">
          Invalid regular expression: {result.query.message}
        </div>
      ) : null}
      {partialNotice ? <div className="search-everywhere__error" role="status">{partialNotice}</div> : null}
      {mode === "searchEverywhere" ? (
        <div className="search-everywhere__body search-everywhere__body--palette">
          <div className="search-results search-results--grouped" role="list" aria-label={resultsLabel} onWheel={handleResultsWheel}>
            {candidateGroups.map((group) => (
              <section key={group.source} className="search-result-group" aria-label={`${group.label} ${group.items.length} results`}>
                <div className="search-result-group__header">
                  <div>
                    <span className="search-result-group__file">{group.label}</span>
                    <span className="search-result-group__path">{group.description}</span>
                  </div>
                  <span className="search-result-group__count">{group.items.length}</span>
                </div>
                <div className="search-result-group__matches">
                  {group.items.map(({ item, index }) => (
                    <SearchCandidateResultItem
                      key={item.id}
                      item={item}
                      index={index}
                      selected={index === selectedIndex}
                      query={query}
                      resultRef={registerResultRef}
                      onSelect={selectResult}
                      onMouseDown={handleCandidateMouseDown}
                      onClick={handleCandidateClick}
                      onContextMenu={handleCandidateContextMenu}
                    />
                  ))}
                </div>
              </section>
            ))}
            {candidates.length === 0 ? (
              <div className="search-everywhere__empty">No matches</div>
            ) : null}
          </div>
        </div>
      ) : (
      <div className="search-everywhere__body search-everywhere__body--text">
        <div className="search-results search-results--grouped" role="list" aria-label={resultsLabel} onWheel={handleResultsWheel}>
          {textGroups.map((group) => (
            <section key={group.path} className="search-result-group" aria-label={`${group.relativePath} ${group.matches.length} matches`}>
              <div className="search-result-group__header">
                <div>
                  <span className="search-result-group__file">{group.fileName}</span>
                  <span className="search-result-group__path">{group.relativePath}</span>
                </div>
                <span className="search-result-group__count">
                  {group.matches.length} {group.matches.length === 1 ? "match" : "matches"}
                </span>
              </div>
              <div className="search-result-group__matches">
                {group.matches.map(({ item, index }) => (
                  <TextSearchResultItem
                    key={`${item.path}:${item.line}:${item.column}`}
                    item={item}
                    index={index}
                    selected={index === selectedIndex}
                    query={query}
                    resultRef={registerResultRef}
                    onSelect={selectResult}
                    onMouseDown={handleTextMouseDown}
                    onClick={handleTextClick}
                    onContextMenu={handleTextContextMenu}
                  />
                ))}
              </div>
            </section>
          ))}
          {result.query.kind !== "invalid" && result.matches.length === 0 ? (
            <div className="search-everywhere__empty">No matches</div>
          ) : null}
          {canLoadMore ? (
            <button
              type="button"
              className="toolbar__button search-everywhere__load-more"
              disabled={pageLoading}
              onClick={onLoadMore}
            >
              {pageLoading ? "Loading..." : "Load more results"}
            </button>
          ) : null}
        </div>
        <div className="search-everywhere__preview" aria-label="Search Everywhere Preview">
          {selectedTextMatch ? <SearchPreviewPane match={selectedTextMatch} content={selectedPreviewContent} /> : <div className="search-everywhere__empty">Select a result to preview</div>}
        </div>
      </div>
      )}
    </div>
    <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </>
  );
}
