import { describe, expect, it } from "vitest";
import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";

describe("workspace query explain model", () => {
  it("prefers explicit reason evidence", () => {
    expect(formatQueryEnvelopeExplain([
      "query:definition",
      "resultCount:0",
      "readiness:Partial",
      "reason:Current file symbols are still indexing",
    ])).toBe("Current file symbols are still indexing");
  });

  it("formats non-ready readiness when no reason is available", () => {
    expect(formatQueryEnvelopeExplain([
      "query:searchEverywhere",
      "readiness:Stale",
    ])).toBe("Index readiness is stale");
  });

  it("formats zero-result evidence when readiness is ready", () => {
    expect(formatQueryEnvelopeExplain([
      "query:usages",
      "readiness:Ready",
      "resultCount:0",
    ])).toBe("Indexed query returned no results");
  });

  it("returns null for empty or non-actionable evidence", () => {
    expect(formatQueryEnvelopeExplain()).toBeNull();
    expect(formatQueryEnvelopeExplain(["query:completion", "readiness:Ready"])).toBeNull();
  });
});
