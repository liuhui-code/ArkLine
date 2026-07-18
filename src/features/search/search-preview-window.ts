export type SearchPreviewLine = {
  lineNumber: number;
  text: string;
};

export type SearchPreviewWindow = {
  lines: SearchPreviewLine[];
  totalLines: number;
};

export type SearchPreviewDocument = {
  content: string;
  lineStarts: number[];
};

export function createSearchPreviewDocument(content: string): SearchPreviewDocument {
  const lineStarts = [0];
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  return { content, lineStarts };
}

export function createSearchPreviewWindow(
  lines: string[],
  hitLine: number,
  radius = 80,
): SearchPreviewWindow {
  const totalLines = lines.length;
  if (totalLines === 0) return { lines: [], totalLines };

  const selected = Math.min(Math.max(hitLine, 1), totalLines);
  const start = Math.max(1, selected - radius);
  const end = Math.min(totalLines, selected + radius);
  return {
    totalLines,
    lines: lines.slice(start - 1, end).map((text, offset) => ({
      lineNumber: start + offset,
      text,
    })),
  };
}

export function createSearchPreviewWindowFromContent(
  content: string,
  hitLine: number,
  radius = 80,
): SearchPreviewWindow {
  return createSearchPreviewWindowFromDocument(
    createSearchPreviewDocument(content),
    hitLine,
    radius,
  );
}

export function createSearchPreviewWindowFromDocument(
  document: SearchPreviewDocument,
  hitLine: number,
  radius = 80,
): SearchPreviewWindow {
  const totalLines = document.lineStarts.length;
  const selected = Math.min(Math.max(hitLine, 1), totalLines);
  const start = Math.max(1, selected - radius);
  const end = Math.min(totalLines, selected + radius);
  return {
    totalLines,
    lines: collectDocumentLines(document, start, end),
  };
}

function collectDocumentLines(
  document: SearchPreviewDocument,
  startLine: number,
  endLine: number,
) {
  const lines: SearchPreviewLine[] = [];
  for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
    const lineStart = document.lineStarts[lineNumber - 1] ?? document.content.length;
    const nextLineStart = document.lineStarts[lineNumber];
    let lineEnd = nextLineStart == null ? document.content.length : nextLineStart - 1;
    if (lineEnd > lineStart && document.content.charCodeAt(lineEnd - 1) === 13) {
      lineEnd -= 1;
    }
    lines.push({
      lineNumber,
      text: document.content.slice(lineStart, lineEnd),
    });
  }
  return lines;
}
