import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SearchPreviewPane } from "@/components/layout/SearchPreviewPane";
import type { WorkspaceTextSearchMatch } from "@/features/search/workspace-text-search";
import * as previewWindow from "@/features/search/search-preview-window";

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

  it("moves between hits in the same content without changing the preview document", () => {
    const content = Array.from({ length: 200 }, (_, index) => `line ${index + 1}`).join("\n");
    const createDocument = vi.spyOn(previewWindow, "createSearchPreviewDocument");
    const { rerender } = render(
      <SearchPreviewPane
        match={match({ line: 40, preview: "line 40", previewStart: 0, previewEnd: 7 })}
        content={content}
      />,
    );

    rerender(
      <SearchPreviewPane
        match={match({ line: 160, preview: "line 160", previewStart: 0, previewEnd: 8 })}
        content={content}
      />,
    );

    expect(screen.getByText("line 160")).toBeVisible();
    expect(screen.getByText("200 lines")).toBeVisible();
    expect(createDocument).toHaveBeenCalledTimes(1);
    createDocument.mockRestore();
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
