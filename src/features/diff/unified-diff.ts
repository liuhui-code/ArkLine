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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const gitEscapes: Record<string, number> = {
  a: 7,
  b: 8,
  t: 9,
  n: 10,
  v: 11,
  f: 12,
  r: 13,
  '"': 34,
  "\\": 92,
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
      currentFile = {
        path: parseGitDiffPath(line),
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

function parseGitDiffPath(line: string) {
  const header = line.slice("diff --git ".length);
  const quotedSecond = header.indexOf(' "b/');
  if (quotedSecond >= 0) {
    return stripGitPrefix(parseGitQuotedPath(header, quotedSecond + 1)?.value ?? header);
  }
  if (header.startsWith('"')) {
    const first = parseGitQuotedPath(header, 0);
    if (first) {
      const secondStart = skipSpaces(header, first.nextIndex);
      const second = header.startsWith('"', secondStart)
        ? parseGitQuotedPath(header, secondStart)?.value
        : header.slice(secondStart);
      if (second) return stripGitPrefix(second);
    }
  }
  const match = /^a\/(.+?) b\/(.+)$/.exec(header);
  return stripGitPrefix(match?.[2] ?? header);
}

function parseGitQuotedPath(value: string, startIndex: number) {
  if (value[startIndex] !== '"') return null;
  const bytes: number[] = [];
  for (let index = startIndex + 1; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '"') {
      return {
        value: textDecoder.decode(Uint8Array.from(bytes)),
        nextIndex: index + 1,
      };
    }
    if (character !== "\\") {
      bytes.push(...textEncoder.encode(character));
      continue;
    }
    const escaped = value[index + 1];
    if (!escaped) break;
    const octal = value.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];
    if (octal) {
      bytes.push(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    bytes.push(gitEscapes[escaped] ?? textEncoder.encode(escaped)[0]!);
    index += 1;
  }
  return null;
}

function skipSpaces(value: string, startIndex: number) {
  let index = startIndex;
  while (value[index] === " ") index += 1;
  return index;
}

function stripGitPrefix(path: string) {
  return path.startsWith("b/") ? path.slice(2) : path;
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
