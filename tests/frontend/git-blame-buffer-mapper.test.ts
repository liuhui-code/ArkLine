import { describe, expect, it } from "vitest";
import { mapBlameToBuffer } from "@/features/git/blame-buffer-mapper";
import type { GitBlameLine } from "@/features/git/git-trace-model";

const blame: GitBlameLine[] = [
  {
    line: 1,
    commit: "aaa1111",
    sourceLine: 1,
    author: "Jane Doe",
    authoredAt: "2026-06-20T10:00:00Z",
    relativeTime: "4d ago",
    summary: "Add entry component",
  },
  {
    line: 2,
    commit: "bbb2222",
    sourceLine: 2,
    author: "Alex Chen",
    authoredAt: "2026-06-21T10:00:00Z",
    relativeTime: "3d ago",
    summary: "Add build method",
  },
  {
    line: 3,
    commit: "ccc3333",
    sourceLine: 3,
    author: "Mina Park",
    authoredAt: "2026-06-22T10:00:00Z",
    relativeTime: "2d ago",
    summary: "Add text widget",
  },
];

describe("mapBlameToBuffer", () => {
  it("keeps committed attribution around an inserted line", () => {
    const result = mapBlameToBuffer({
      baseText: "@Entry\nbuild() {}\nText('Hi')",
      currentText: "@Entry\n@Component\nbuild() {}\nText('Hi')",
      blameLines: blame,
    });

    expect(result.map((line) => ({
      bufferLine: line.bufferLine,
      status: line.status,
      author: line.author,
      sourceLine: line.sourceLine,
    }))).toEqual([
      { bufferLine: 1, status: "committed", author: "Jane Doe", sourceLine: 1 },
      { bufferLine: 2, status: "added", author: undefined, sourceLine: undefined },
      { bufferLine: 3, status: "committed", author: "Alex Chen", sourceLine: 2 },
      { bufferLine: 4, status: "committed", author: "Mina Park", sourceLine: 3 },
    ]);
  });

  it("marks changed lines as modified while preserving original attribution", () => {
    const result = mapBlameToBuffer({
      baseText: "@Entry\nbuild() {}\nText('Hi')",
      currentText: "@Entry\nbuild() { return }\nText('Hi')",
      blameLines: blame,
    });

    expect(result[1]).toMatchObject({
      bufferLine: 2,
      status: "modified",
      originalCommit: "bbb2222",
      originalAuthor: "Alex Chen",
    });
  });

  it("returns committed rows unchanged when text matches the base", () => {
    const result = mapBlameToBuffer({
      baseText: "@Entry\nbuild() {}\nText('Hi')",
      currentText: "@Entry\nbuild() {}\nText('Hi')",
      blameLines: blame,
    });

    expect(result.every((line) => line.status === "committed")).toBe(true);
    expect(result.map((line) => line.bufferLine)).toEqual([1, 2, 3]);
  });
});
