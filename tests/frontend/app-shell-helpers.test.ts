import { describe, expect, it } from "vitest";
import { extractCompletionPrefix, getLineTextBeforeCursor } from "@/components/layout/app-shell-helpers";

describe("app shell helpers", () => {
  it("extracts completion prefix without requiring a full document split", () => {
    const content = `${"a\n".repeat(2000)}Button().wid\n${"z\n".repeat(2000)}`;

    expect(extractCompletionPrefix(content, 2001, 13)).toBe("wid");
    expect(getLineTextBeforeCursor(content, 2001, 10)).toBe("Button().");
  });

  it("handles CRLF line endings like the previous split-based prefix parser", () => {
    const content = "first\r\nColumn().hei\r\nlast";

    expect(extractCompletionPrefix(content, 2, 13)).toBe("hei");
    expect(getLineTextBeforeCursor(content, 2, 10)).toBe("Column().");
  });

  it("returns empty text for lines outside the document", () => {
    expect(extractCompletionPrefix("build", 4, 99)).toBe("");
    expect(getLineTextBeforeCursor("build", 4, 99)).toBe("");
  });
});
