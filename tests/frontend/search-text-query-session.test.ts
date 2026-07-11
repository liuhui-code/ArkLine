import { describe, expect, it } from "vitest";
import { planSearchTextQuery } from "@/features/search/search-text-query-session";

const plainOptions = { caseSensitive: false, wholeWord: false };

describe("search text query session", () => {
  it("clears short queries before any backend plan", () => {
    expect(planSearchTextQuery({
      query: "a",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: true,
    })).toEqual({ kind: "clear", query: "a" });
  });

  it("uses indexed text facade for plain clean text queries", () => {
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: true,
    })).toEqual({ kind: "indexed", query: "width" });
  });

  it("falls back when text options or dirty documents require live content", () => {
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: { caseSensitive: true, wholeWord: false },
      dirty: false,
      indexedAvailable: true,
    }).kind).toBe("fallback");
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: true,
      indexedAvailable: true,
    }).kind).toBe("fallback");
  });

  it("falls back for regex queries or missing indexed support", () => {
    expect(planSearchTextQuery({
      query: "/width/",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: true,
    }).kind).toBe("fallback");
    expect(planSearchTextQuery({
      query: "width",
      minimumQueryLength: 2,
      options: plainOptions,
      dirty: false,
      indexedAvailable: false,
    }).kind).toBe("fallback");
  });
});
