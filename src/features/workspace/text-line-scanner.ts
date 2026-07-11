export type LineScanEntry = {
  text: string;
  line: number;
  start: number;
  end: number;
};

export function getOffsetAtLineColumn(content: string, line: number, column: number) {
  const bounds = findLineBounds(content, line);
  const safeColumn = Math.max(column - 1, 0);
  return Math.min(bounds.start + safeColumn, bounds.end);
}

export function getLineText(content: string, line: number) {
  const bounds = findLineBounds(content, line);
  return content.slice(bounds.start, bounds.end);
}

export function scanLines(
  content: string,
  onLine: (entry: LineScanEntry) => boolean | void,
) {
  let line = 1;
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) {
      continue;
    }

    const end = trimCarriageReturn(content, index);
    if (onLine({ text: content.slice(start, end), line, start, end }) === false) {
      return;
    }
    line += 1;
    start = index + 1;
  }

  const end = content.length;
  onLine({ text: content.slice(start, end), line, start, end });
}

function findLineBounds(content: string, line: number) {
  const targetLine = Math.max(1, line);
  let currentLine = 1;
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) !== 10) {
      continue;
    }

    if (currentLine === targetLine) {
      return { start, end: trimCarriageReturn(content, index) };
    }

    currentLine += 1;
    start = index + 1;
    if (currentLine > targetLine) {
      break;
    }
  }

  if (currentLine === targetLine) {
    return { start, end: content.length };
  }
  return { start: content.length, end: content.length };
}

function trimCarriageReturn(content: string, lineEnd: number) {
  return lineEnd > 0 && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
}
