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
