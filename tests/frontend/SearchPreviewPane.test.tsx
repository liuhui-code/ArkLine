import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchPreviewPane } from "@/components/layout/SearchPreviewPane";
import type { WorkspaceTextSearchMatch } from "@/features/search/workspace-text-search";

describe("SearchPreviewPane", () => {
  it("renders a centered file preview when content is available", () => {
    render(
      <SearchPreviewPane
        match={match({ line: 3, preview: "selected width", previewStart: 9, previewEnd: 14 })}
        content={"first\nsecond\nselected width\nfourth\nfifth"}
      />,
    );

    expect(screen.getByText("Entry.ets")).toBeVisible();
    expect(screen.getByText("5 lines")).toBeVisible();
    expect(screen.getByText("selected")).toBeVisible();
    expect(screen.getByText("width")).toBeVisible();
  });

  it("falls back to compact context while full content is loading", () => {
    render(
      <SearchPreviewPane
        match={match({
          line: 7,
          contextBefore: [{ line: 6, text: "before" }],
          contextAfter: [{ line: 8, text: "after" }],
        })}
        content={null}
      />,
    );

    const preview = screen.getByLabelText("Search result file preview");
    expect(within(preview).getByText("Loading file preview")).toBeVisible();
    expect(within(preview).getByText("before")).toBeVisible();
    expect(within(preview).getByText("after")).toBeVisible();
  });
});

function match(overrides: Partial<WorkspaceTextSearchMatch> = {}): WorkspaceTextSearchMatch {
  return {
    path: "/workspace/src/Entry.ets",
    relativePath: "src/Entry.ets",
    fileName: "Entry.ets",
    line: 7,
    column: 2,
    summary: "width",
    preview: "width",
    previewStart: 0,
    previewEnd: 5,
    contextBefore: [],
    contextAfter: [],
    ...overrides,
  };
}
