export type DiffLineKind = "context" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  text: string;
};

export type DiffHunk = {
  header: string;
  lines: DiffLine[];
};

export type DiffFile = {
  path: string;
  binary: boolean;
  hunks: DiffHunk[];
};

function toDiffLine(line: string): DiffLine | null {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return { kind: "added", text: line.slice(1) };
  }

  if (line.startsWith("-") && !line.startsWith("---")) {
    return { kind: "removed", text: line.slice(1) };
  }

  if (line.startsWith(" ")) {
    return { kind: "context", text: line.slice(1) };
  }

  return null;
}

export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const lines = diffText.split(/\r?\n/);
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;

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
      currentHunk = {
        header: line,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      return;
    }

    const diffLine = toDiffLine(line);
    if (diffLine && currentHunk) {
      currentHunk.lines.push(diffLine);
    }
  });

  return files;
}
