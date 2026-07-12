import { describe, expect, it } from "vitest";
import { toggleSearchTextOption } from "@/components/layout/search-text-options-state";

describe("search text options state", () => {
  it("toggles case sensitivity without changing other options", () => {
    expect(toggleSearchTextOption({
      caseSensitive: false,
      wholeWord: true,
    }, "caseSensitive")).toEqual({
      caseSensitive: true,
      wholeWord: true,
    });
  });

  it("toggles whole word without changing other options", () => {
    expect(toggleSearchTextOption({
      caseSensitive: true,
      wholeWord: false,
    }, "wholeWord")).toEqual({
      caseSensitive: true,
      wholeWord: true,
    });
  });
});
