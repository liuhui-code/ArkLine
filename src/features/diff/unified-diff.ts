export type DiffLineKind = "context" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
  noNewline: boolean;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffFile = {
  path: string;
  binary: boolean;
  hunks: DiffHunk[];
};

function toDiffLine(line: string, oldLine: number, newLine: number): DiffLine | null {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { kind: "added", text: line.slice(1), oldLine: null, newLine, noNewline: false };
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return { kind: "removed", text: line.slice(1), oldLine, newLine: null, noNewline: false };
  }

  if (line.startsWith(" ")) {
    return { kind: "context", text: line.slice(1), oldLine, newLine, noNewline: false };
  }

  return null;
}

export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const lines = diffText.split(/\r?\n/);
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  lines.forEach((line) => {
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      const path = match?.[2] ?? line.replace("diff --git ", "");

      currentFile = {
        path,
        binary: false,
        hunks: [],
      };
      currentHunk = null;
      files.push(currentFile);
      return;
    }

    if (!currentFile) {
      return;
    }

    if (line.startsWith("Binary files ")) {
      currentFile.binary = true;
      currentHunk = null;
      return;
    }

    if (line.startsWith("@@")) {
      const range = parseHunkRange(line);
      if (!range) {
        currentHunk = null;
        return;
      }
      currentHunk = {
        header: line,
        ...range,
        lines: [],
      };
      oldLine = range.oldStart;
      newLine = range.newStart;
      currentFile.hunks.push(currentHunk);
      return;
    }

    if (line === "\\ No newline at end of file" && currentHunk?.lines.length) {
      currentHunk.lines[currentHunk.lines.length - 1]!.noNewline = true;
      return;
    }
    const diffLine = toDiffLine(line, oldLine, newLine);
    if (diffLine && currentHunk) {
      currentHunk.lines.push(diffLine);
      if (diffLine.kind !== "added") oldLine += 1;
      if (diffLine.kind !== "removed") newLine += 1;
    }
  });

  return files;
}

function parseHunkRange(header: string) {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    oldCount: Number(match[2] ?? 1),
    newStart: Number(match[3]),
    newCount: Number(match[4] ?? 1),
  };
}
