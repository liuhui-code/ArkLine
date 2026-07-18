import {
  createSearchPreviewDocument,
  createSearchPreviewWindowFromDocument,
} from "@/features/search/search-preview-window";
import type { WorkspaceTextSearchMatch } from "@/features/search/workspace-text-search";
import { memo, useMemo } from "react";

type SearchPreviewPaneProps = {
  match: WorkspaceTextSearchMatch;
  content: string | null;
};

export const SearchPreviewPane = memo(function SearchPreviewPane({ match, content }: SearchPreviewPaneProps) {
  const hitLine = highlightPreview(match.preview, match.previewStart, match.previewEnd);
  const previewDocument = useMemo(
    () => content != null ? createSearchPreviewDocument(content) : null,
    [content],
  );
  const previewWindow = useMemo(
    () => previewDocument ? createSearchPreviewWindowFromDocument(previewDocument, match.line) : null,
    [match.line, previewDocument],
  );

  return (
    <section aria-label="Search result file preview">
      <div className="search-everywhere__preview-header">
        <div>
          <strong>{match.fileName}</strong>
          <span>{match.relativePath}:{match.line}:{match.column}</span>
        </div>
        <span>{previewWindow ? `${previewWindow.totalLines.toLocaleString()} lines` : "Loading file preview"}</span>
      </div>
      <pre className="search-everywhere__preview-code">
        {previewWindow ? previewWindow.lines.map((line) => {
          const lineNumber = line.lineNumber;
          return (
            <div
              key={`file:${lineNumber}`}
              className={`search-everywhere__preview-line${lineNumber === match.line ? " search-everywhere__preview-line--hit" : ""}`}
            >
              <span className="search-everywhere__preview-number">{lineNumber}</span>
              <span>{lineNumber === match.line ? hitLine : line.text}</span>
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
    </section>
  );
});

function highlightPreview(line: string, start: number, end: number) {
  return (
    <>
      {line.slice(0, start)}
      <mark className="search-everywhere__preview-hit">{line.slice(start, end)}</mark>
      {line.slice(end)}
    </>
  );
}
