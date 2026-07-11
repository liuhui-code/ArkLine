import { describe, expect, it, vi } from "vitest";
import { buildLanguageQueryRequest } from "@/components/layout/language-query-request-model";

describe("language query request model", () => {
  it("builds a stable language query request from the active document snapshot", () => {
    const getActiveContent = vi.fn(() => "class Entry {}");

    expect(buildLanguageQueryRequest({
      activePath: "/workspace/Entry.ets",
      editorSelection: { line: 7, column: 5 },
      getActiveContent,
    })).toEqual({
      path: "/workspace/Entry.ets",
      line: 7,
      column: 5,
      content: "class Entry {}",
    });
    expect(getActiveContent).toHaveBeenCalledTimes(1);
  });
});
