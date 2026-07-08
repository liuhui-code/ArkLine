export type SearchPreviewLine = {
  lineNumber: number;
  text: string;
};

export type SearchPreviewWindow = {
  lines: SearchPreviewLine[];
  totalLines: number;
};

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
  const totalLines = countContentLines(content);
  const selected = Math.min(Math.max(hitLine, 1), totalLines);
  const start = Math.max(1, selected - radius);
  const end = Math.min(totalLines, selected + radius);
  return {
    totalLines,
    lines: collectContentLines(content, start, end),
  };
}

function countContentLines(content: string) {
  let total = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 10) total += 1;
  }
  return total;
}

function collectContentLines(content: string, startLine: number, endLine: number) {
  const lines: SearchPreviewLine[] = [];
  let lineNumber = 1;
  let lineStart = 0;
  for (let index = 0; index <= content.length; index += 1) {
    if (index < content.length && content.charCodeAt(index) !== 10) continue;
    if (lineNumber >= startLine && lineNumber <= endLine) {
      const lineEnd = index > lineStart && content.charCodeAt(index - 1) === 13 ? index - 1 : index;
      lines.push({ lineNumber, text: content.slice(lineStart, lineEnd) });
    }
    lineNumber += 1;
    lineStart = index + 1;
    if (lineNumber > endLine) break;
  }
  return lines;
}
