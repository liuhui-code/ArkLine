import { describe, expect, it, vi } from "vitest";
import { createSearchMissReporters } from "@/components/layout/search-miss-reporters";

describe("search miss reporters", () => {
  it("binds Search Everywhere miss reporting dependencies", async () => {
    const explainIndexMiss = vi.fn(async () => "No indexed evidence");
    const onStatusChange = vi.fn();
    const reporters = createSearchMissReporters({
      isCurrentQuery: () => true,
      explainIndexMiss,
      recordRecentQueryExplain: vi.fn(),
      onStatusChange,
    });

    reporters.reportEntityMiss(4, { query: "Missing", explain: undefined });
    await Promise.resolve();

    expect(explainIndexMiss).toHaveBeenCalledWith("search", "Missing");
    expect(onStatusChange).toHaveBeenCalledWith("Search Everywhere miss: No indexed evidence");
  });

  it("binds text miss reporting dependencies", async () => {
    const explainIndexMiss = vi.fn(async () => "No indexed evidence");
    const onStatusChange = vi.fn();
    const reporters = createSearchMissReporters({
      isCurrentQuery: () => true,
      explainIndexMiss,
      recordRecentQueryExplain: vi.fn(),
      onStatusChange,
    });

    reporters.reportTextMiss(5, {
      mode: "find",
      query: "missingText",
      result: { query: { kind: "text", query: "missingText" }, matches: [] },
      suppressMissExplain: false,
    });
    await Promise.resolve();

    expect(explainIndexMiss).toHaveBeenCalledWith("search", "missingText");
    expect(onStatusChange).toHaveBeenCalledWith("Find in Files miss: No indexed evidence");
  });
});
