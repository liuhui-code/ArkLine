import type { GitBlameAttribution, GitBlameLine } from "@/features/git/git-trace-model";

type MapBlameToBufferArgs = {
  baseText: string;
  currentText: string;
  blameLines: GitBlameLine[];
};

export function mapBlameToBuffer({ baseText, currentText, blameLines }: MapBlameToBufferArgs): GitBlameAttribution[] {
  const baseLines = splitLines(baseText);
  const currentLines = splitLines(currentText);
  const blameByLine = new Map(blameLines.map((line) => [line.line, line]));
  const rows: GitBlameAttribution[] = [];
  let baseIndex = 0;
  let currentIndex = 0;

  while (currentIndex < currentLines.length) {
    const currentLine = currentLines[currentIndex] ?? "";
    const baseLine = baseLines[baseIndex];

    if (baseLine === currentLine) {
      rows.push(committedAttribution(currentIndex + 1, blameByLine.get(baseIndex + 1)));
      baseIndex += 1;
      currentIndex += 1;
      continue;
    }

    const nextCurrentLine = currentLines[currentIndex + 1];
    if (nextCurrentLine !== undefined && baseLine !== undefined && nextCurrentLine === baseLine) {
      rows.push({ bufferLine: currentIndex + 1, status: "added" });
      currentIndex += 1;
      continue;
    }

    const matchingBaseIndex = findNextMatchingLine(baseLines, baseIndex + 1, currentLine);
    if (matchingBaseIndex >= 0) {
      baseIndex = matchingBaseIndex;
      rows.push(committedAttribution(currentIndex + 1, blameByLine.get(baseIndex + 1)));
      baseIndex += 1;
      currentIndex += 1;
      continue;
    }

    if (baseLine === undefined) {
      rows.push({ bufferLine: currentIndex + 1, status: "added" });
      currentIndex += 1;
      continue;
    }

    rows.push(modifiedAttribution(currentIndex + 1, blameByLine.get(baseIndex + 1)));
    baseIndex += 1;
    currentIndex += 1;
  }

  return rows;
}

function splitLines(text: string) {
  return text.length === 0 ? [""] : text.split(/\r?\n/);
}

function findNextMatchingLine(lines: string[], startIndex: number, target: string) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (lines[index] === target) {
      return index;
    }
  }
  return -1;
}

function committedAttribution(bufferLine: number, blame?: GitBlameLine): GitBlameAttribution {
  if (!blame) {
    return { bufferLine, status: "unavailable" };
  }

  return {
    bufferLine,
    sourceLine: blame.sourceLine,
    status: "committed",
    commit: blame.commit,
    shortCommit: blame.commit.slice(0, 7),
    author: blame.author,
    authoredAt: blame.authoredAt,
    relativeTime: blame.relativeTime,
    summary: blame.summary,
  };
}

function modifiedAttribution(bufferLine: number, blame?: GitBlameLine): GitBlameAttribution {
  const attribution = committedAttribution(bufferLine, blame);
  return {
    ...attribution,
    status: "modified",
    originalCommit: blame?.commit,
    originalAuthor: blame?.author,
  };
}
