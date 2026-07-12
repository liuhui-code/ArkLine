import { describe, expect, it } from "vitest";
import { createSearchControllerContext } from "@/components/layout/search-controller-context";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { WorkspaceIndexQueryScope } from "@/features/workspace/workspace-api";

describe("search controller context", () => {
  it("exposes current search state through stable getters", () => {
    let mode: SearchEverywhereMode = "find";
    let query = "width";
    let rootPath: string | null = "/workspace";
    let scope: WorkspaceIndexQueryScope = "all";
    let options = { caseSensitive: false, wholeWord: false };
    const context = createSearchControllerContext({
      getMode: () => mode,
      getQuery: () => query,
      getRootPath: () => rootPath,
      getScope: () => scope,
      getOptions: () => options,
    });

    expect(context.getMode()).toBe("find");
    expect(context.getQuery()).toBe("width");
    expect(context.getRootPath()).toBe("/workspace");
    expect(context.getScope()).toBe("all");
    expect(context.getOptions()).toEqual({ caseSensitive: false, wholeWord: false });

    mode = "searchEverywhere";
    query = "Entry";
    rootPath = null;
    scope = "classes";
    options = { caseSensitive: true, wholeWord: true };

    expect(context.getMode()).toBe("searchEverywhere");
    expect(context.getQuery()).toBe("Entry");
    expect(context.getRootPath()).toBeNull();
    expect(context.getScope()).toBe("classes");
    expect(context.getOptions()).toEqual({ caseSensitive: true, wholeWord: true });
  });
});
