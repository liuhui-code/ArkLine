import { describe, expect, it } from "vitest";
import { getLineText, getOffsetAtLineColumn, scanLines } from "@/features/workspace/text-line-scanner";

describe("text line scanner", () => {
  it("locates a line and column in large content without line arrays", () => {
    const content = `${"a\n".repeat(3000)}Button().width\n${"z\n".repeat(3000)}`;

    expect(getLineText(content, 3001)).toBe("Button().width");
    expect(content.slice(getOffsetAtLineColumn(content, 3001, 10))).toMatch(/^width/);
  });

  it("handles CRLF lines without exposing carriage returns", () => {
    const content = "first\r\nsecond\r\nthird";

    expect(getLineText(content, 2)).toBe("second");
    expect(getOffsetAtLineColumn(content, 2, 4)).toBe(content.indexOf("second") + 3);
  });

  it("supports early exit while scanning lines", () => {
    const visited: string[] = [];

    scanLines("one\ntwo\nthree", ({ text }) => {
      visited.push(text);
      return text !== "two";
    });

    expect(visited).toEqual(["one", "two"]);
  });
});
