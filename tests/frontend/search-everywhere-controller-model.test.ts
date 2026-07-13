import { textSearchPartialNotice } from "@/components/layout/search-everywhere-controller-model";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";

describe("search everywhere controller model", () => {
  it("includes regex prefilter skip evidence in partial notices", () => {
    const result: WorkspaceTextSearchResult = {
      query: { kind: "regex", query: "/Text\\(.+\\)/" },
      matches: [],
      partial: true,
      searchedFiles: 12,
      prefilterSkippedFiles: 40,
      limitReached: true,
    };

    expect(textSearchPartialNotice(result)).toContain("skipped 40 prefiltered file(s)");
  });

  it("omits prefilter evidence when no files were skipped", () => {
    const result: WorkspaceTextSearchResult = {
      query: { kind: "text", query: "width" },
      matches: [],
      partial: true,
      searchedFiles: 12,
      prefilterSkippedFiles: 0,
      limitReached: true,
    };

    expect(textSearchPartialNotice(result)).not.toContain("prefiltered");
  });
});
