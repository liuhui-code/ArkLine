import { describe, expect, it } from "vitest";
import {
  decideDefinitionEnvelope,
  definitionCandidatesToUsageItems,
  formatDefinitionCandidateDebugMessage,
  formatDefinitionCandidatePanelMessage,
  formatDefinitionCandidateStatus,
  formatDefinitionBlockedDebugMessage,
  formatDefinitionBlockedStatus,
  formatDefinitionEnvelopeExplanation,
  formatDefinitionMissMessage,
  formatDefinitionQueryDebugMessage,
  formatDefinitionQueryStatus,
  formatDefinitionRefreshWaitMessage,
  formatDefinitionResolvedDebugMessage,
  formatDefinitionResolvedStatus,
  formatDefinitionUnavailableDebugMessage,
  formatDefinitionUnavailableStatus,
} from "@/features/workspace/definition-query-model";

const candidate = { path: "/workspace/src/A.ets", line: 8, column: 6, preview: "class A" };

describe("definition query model", () => {
  it("decides indexed definition envelope outcomes", () => {
    expect(decideDefinitionEnvelope({
      items: [],
      readiness: { state: "blocked", reason: "Foreground index is busy" },
    })).toEqual({ kind: "blocked", message: "Foreground index is busy" });

    expect(decideDefinitionEnvelope({
      items: [candidate, { ...candidate, path: "/workspace/src/B.ets" }],
      readiness: { state: "ready" },
    })).toEqual({
      kind: "candidates",
      items: [candidate, { ...candidate, path: "/workspace/src/B.ets" }],
      readinessState: "ready",
    });

    expect(decideDefinitionEnvelope({
      items: [candidate],
      readiness: { state: "stale" },
    })).toEqual({ kind: "resolved", target: candidate, readinessState: "stale" });

    expect(decideDefinitionEnvelope({
      items: [candidate, { ...candidate, path: "/workspace/src/B.ets" }],
      readiness: { state: "partial" },
    })).toEqual({ kind: "waitForRefresh", count: 2, readinessState: "partial" });

    expect(decideDefinitionEnvelope({
      items: [],
      readiness: { state: "missing" },
    })).toEqual({ kind: "defer" });
  });

  it("formats unavailable and blocked definition states", () => {
    expect(formatDefinitionUnavailableStatus("missingPosition"))
      .toBe("Ctrl+Click received, but editor position could not be resolved");
    expect(formatDefinitionUnavailableStatus("settingsApplying")).toBe("SDK settings are still applying");
    expect(formatDefinitionUnavailableStatus("lookupUnavailable")).toBe("Go to Definition unavailable");
    expect(formatDefinitionUnavailableDebugMessage("modifierClick", "settingsApplying"))
      .toBe("Ctrl+Click is paused while SDK settings are applying.");
    expect(formatDefinitionUnavailableDebugMessage("keyboard", "lookupUnavailable")).toBeUndefined();

    expect(formatDefinitionBlockedStatus("Current file index is rebuilding"))
      .toBe("Go to Definition blocked: Current file index is rebuilding");
    expect(formatDefinitionBlockedDebugMessage("modifierClick", "Current file index is rebuilding"))
      .toBe("Ctrl+Click blocked: Current file index is rebuilding");
    expect(formatDefinitionBlockedDebugMessage("keyboard", "Current file index is rebuilding")).toBeUndefined();
  });

  it("formats definition query start messages", () => {
    expect(formatDefinitionQueryStatus("keyboard", "A.ets", 4, 2))
      .toBe("Go to Definition query: A.ets:4:2");
    expect(formatDefinitionQueryStatus("modifierClick", "A.ets", 4, 2))
      .toBe("Ctrl+Click query: A.ets:4:2");
    expect(formatDefinitionQueryDebugMessage("keyboard", "A.ets", 4, 2)).toBeUndefined();
    expect(formatDefinitionQueryDebugMessage("modifierClick", "A.ets", 4, 2))
      .toBe("Ctrl+Click query fired at A.ets:4:2. Waiting for language lookup...");
  });

  it("formats default indexed miss messages", () => {
    expect(formatDefinitionMissMessage({
      source: "keyboard",
      cause: "indexedNoTarget",
    })).toBe("Go to Definition miss: indexed definition lookup returned no target");

    expect(formatDefinitionMissMessage({
      source: "modifierClick",
      cause: "indexedNoTarget",
    })).toBe("Ctrl+Click miss: indexed definition lookup returned no target");
  });

  it("formats language and fallback miss messages", () => {
    expect(formatDefinitionMissMessage({
      source: "keyboard",
      cause: "languageAndFallbackNoTarget",
    })).toBe("Go to Definition miss: language service and local fallback returned no target");
  });

  it("uses explicit explain text when present", () => {
    expect(formatDefinitionMissMessage({
      source: "modifierClick",
      cause: "languageAndFallbackNoTarget",
      explanation: "Current file symbols are still indexing",
    })).toBe("Ctrl+Click miss: Current file symbols are still indexing");
  });

  it("formats envelope explain evidence", () => {
    expect(formatDefinitionEnvelopeExplanation([
      "query:definition",
      "readiness:Partial",
      "reason:Definition waits for current file symbol index",
    ])).toBe("Definition waits for current file symbol index");
  });

  it("maps definition candidates to shared query panel usage items", () => {
    expect(definitionCandidatesToUsageItems([
      {
        path: "/workspace/src/A.ets",
        line: 4,
        column: 3,
        preview: "class A",
      },
    ])).toEqual([
      {
        path: "/workspace/src/A.ets",
        line: 4,
        column: 3,
        preview: "class A",
        kind: "definition",
        confidence: "fallback",
      },
    ]);
  });

  it("formats definition candidate status and panel messages", () => {
    expect(formatDefinitionCandidateStatus(3)).toBe("Definition candidates: 3");
    expect(formatDefinitionCandidatePanelMessage("ready")).toBeUndefined();
    expect(formatDefinitionCandidatePanelMessage("partial")).toBe("Index is partial; choose an exact definition candidate.");
  });

  it("formats modifier-click candidate debug messages", () => {
    expect(formatDefinitionCandidateDebugMessage("keyboard", "semantic", 2)).toBeUndefined();
    expect(formatDefinitionCandidateDebugMessage("modifierClick", "semantic", 2))
      .toBe("Ctrl+Click found 2 semantic definition candidates. Choose one from the editor query panel.");
  });

  it("formats refresh wait messages", () => {
    expect(formatDefinitionRefreshWaitMessage(2, "stale"))
      .toBe("Go to Definition has 2 stale candidates; wait for the index to refresh.");
  });

  it("formats resolved definition status messages", () => {
    const target = { path: candidate.path, line: candidate.line, column: candidate.column };

    expect(formatDefinitionResolvedStatus(target, "A.ets", "semantic"))
      .toBe("Definition: A.ets:8:6");
    expect(formatDefinitionResolvedStatus(target, "A.ets", "fallback"))
      .toBe("Definition fallback: A.ets:8:6");
  });

  it("formats modifier-click resolved debug messages", () => {
    const target = { path: candidate.path, line: candidate.line, column: candidate.column };

    expect(formatDefinitionResolvedDebugMessage("keyboard", target, "A.ets", "semantic")).toBeUndefined();
    expect(formatDefinitionResolvedDebugMessage("modifierClick", target, "A.ets", "indexed", "stale"))
      .toBe("Index (stale) resolved Ctrl+Click to A.ets:8:6.");
    expect(formatDefinitionResolvedDebugMessage("modifierClick", target, "A.ets", "indexed", "missing"))
      .toBe("Index (missing) resolved Ctrl+Click to A.ets:8:6.");
    expect(formatDefinitionResolvedDebugMessage("modifierClick", target, "A.ets", "semantic"))
      .toBe("Language service resolved Ctrl+Click to A.ets:8:6.");
    expect(formatDefinitionResolvedDebugMessage("modifierClick", target, "A.ets", "fallback"))
      .toBe("Same-file fallback resolved Ctrl+Click to A.ets:8:6.");
  });
});
