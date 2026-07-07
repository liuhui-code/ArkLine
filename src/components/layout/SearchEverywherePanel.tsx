import { ContextMenu, type ContextMenuState } from "@/components/layout/ContextMenu";
import { englishQueryInputProps } from "@/components/layout/query-input-props";
import { SearchCandidateResultItem, TextSearchResultItem } from "@/components/layout/SearchResultItems";
import type {
  WorkspaceTextSearchMatch,
  WorkspaceTextSearchOptions,
  WorkspaceTextSearchResult,
} from "@/features/search/workspace-text-search";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type WheelEvent } from "react";

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
  partialNotice?: string | null;
  onChangeQuery: (value: string) => void;
  onChangeScope: (scope: WorkspaceIndexQueryScope) => void;
  onChangeReplaceQuery: (value: string) => void;
  onMoveSelection: (direction: 1 | -1) => void;
  onOpenSelected: () => void;
  onSelectResult: (index: number) => void;
  onOpenResult: (result: WorkspaceTextSearchMatch) => void;
  onOpenCandidate: (candidate: SearchCandidate) => void;
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
  partialNotice,
  onChangeQuery,
  onChangeScope,
  onChangeReplaceQuery,
  onMoveSelection,
  onOpenSelected,
  onSelectResult,
  onOpenResult,
  onOpenCandidate,
  onToggleCaseSensitive,
  onToggleWholeWord,
  onCloseOverlay,
}: SearchEverywherePanelProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const selected = result.matches[selectedIndex] ?? null;
  const regexMode = result.query.kind === "regex" || result.query.kind === "invalid";
  const presentation = searchModePresentation(mode, regexMode);
  const groups = groupSearchMatches(result.matches);
  const candidateGroups = groupSearchCandidates(candidates);
  const resultsLabel = `${presentation.title} Results`;
  const resultCount = mode === "searchEverywhere" ? candidates.length : result.matches.length;
  const pointerOpenRef = useRef(0);
  const resultRefs = useRef(new Map<number, HTMLButtonElement>());

  useEffect(() => {
    const selectedResult = resultRefs.current.get(selectedIndex);
    if (selectedResult && typeof selectedResult.scrollIntoView === "function") {
      selectedResult.scrollIntoView({ block: "center" });
    }
  }, [mode, resultCount, selectedIndex]);

  function registerResultRef(index: number, node: HTMLButtonElement | null) {
    if (node) resultRefs.current.set(index, node);
    else resultRefs.current.delete(index);
  }

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
    if (resultCount <= 0 || Math.abs(event.deltaY) < 12) {
      return;
    }

    onMoveSelection(event.deltaY > 0 ? 1 : -1);
  }

  function copyPath(path: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
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
        <input
          aria-label={`${presentation.title} Query`}
          autoFocus
          className="panel-input"
          {...englishQueryInputProps}
          value={query}
          placeholder={presentation.searchPlaceholder}
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === "Escape") {
              event.preventDefault();
            }
          }}
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
                      resultRef={(node) => registerResultRef(index, node)}
                      onSelect={onSelectResult}
                      onMouseDown={(event) => openByMouseDown(event, index, () => onOpenCandidate(item))}
                      onClick={(event) => openByClick(event, index, () => onOpenCandidate(item))}
                      onContextMenu={(event) => openCandidateContextMenu(event, item, index)}
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
          {groups.map((group) => (
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
                    resultRef={(node) => registerResultRef(index, node)}
                    onSelect={onSelectResult}
                    onMouseDown={(event) => openByMouseDown(event, index, () => onOpenResult(item))}
                    onClick={(event) => openByClick(event, index, () => onOpenResult(item))}
                    onContextMenu={(event) => openTextResultContextMenu(event, item, index)}
                  />
                ))}
              </div>
            </section>
          ))}
          {result.query.kind !== "invalid" && result.matches.length === 0 ? (
            <div className="search-everywhere__empty">No matches</div>
          ) : null}
        </div>
        <div className="search-everywhere__preview" aria-label="Search Everywhere Preview">
          {selected ? <SearchPreview match={selected} content={selectedPreviewContent} /> : <div className="search-everywhere__empty">Select a result to preview</div>}
        </div>
      </div>
      )}
    </div>
    <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
    </>
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

function groupSearchCandidates(candidates: SearchCandidate[]) {
  const order: SearchCandidate["source"][] = ["class", "symbol", "file", "api", "action", "sdk", "text"];
  return order
    .map((source) => ({
      source,
      label: candidateGroupLabel(source),
      description: candidateGroupDescription(source),
      items: candidates
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.source === source),
    }))
    .filter((group) => group.items.length > 0);
}

function candidateGroupLabel(source: SearchCandidate["source"]) {
  if (source === "class") return "Classes";
  if (source === "symbol") return "Symbols";
  if (source === "file") return "Files";
  if (source === "action") return "Actions";
  if (source === "api") return "API";
  if (source === "sdk") return "SDK";
  return "Text";
}

function candidateGroupDescription(source: SearchCandidate["source"]) {
  if (source === "class") return "types and ArkUI structs";
  if (source === "symbol") return "functions and methods";
  if (source === "file") return "workspace files";
  if (source === "action") return "commands";
  if (source === "api") return "SDK and system APIs";
  if (source === "sdk") return "SDK declarations";
  return "content matches";
}

function SearchPreview({ match, content }: { match: WorkspaceTextSearchMatch; content: string | null }) {
  const hitLine = highlightPreview(match.preview, match.previewStart, match.previewEnd);
  const lines = content?.split(/\r?\n/u) ?? null;

  return (
    <>
      <div className="search-everywhere__preview-header">
        <div>
          <strong>{match.fileName}</strong>
          <span>{match.relativePath}:{match.line}:{match.column}</span>
        </div>
        <span>{lines ? `${lines.length.toLocaleString()} lines` : "Loading file preview"}</span>
      </div>
      <pre className="search-everywhere__preview-code">
        {lines ? lines.map((line, index) => {
          const lineNumber = index + 1;
          return (
            <div
              key={`file:${lineNumber}`}
              className={`search-everywhere__preview-line${lineNumber === match.line ? " search-everywhere__preview-line--hit" : ""}`}
            >
              <span className="search-everywhere__preview-number">{lineNumber}</span>
              <span>{lineNumber === match.line ? hitLine : line}</span>
            </div>
          );
        }) : (
          <>
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
          </>
        )}
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
