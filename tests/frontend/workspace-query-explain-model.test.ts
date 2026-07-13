import { describe, expect, it } from "vitest";
import {
  buildQueryExplainTimeline,
  formatQueryEnvelopeExplain,
  getQueryExplainActionButtonLabel,
  summarizeQueryEventPayload,
  summarizeQueryEnvelopeExplain,
} from "@/features/workspace/workspace-query-explain-model";

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

  it("formats actionable backend guidance when available", () => {
    expect(formatQueryEnvelopeExplain([
      "query:definition",
      "readiness:Stale",
      "retryable:true",
      "action:waitForIndex",
    ])).toBe("Index is still catching up. Retry after indexing finishes.");

    expect(formatQueryEnvelopeExplain([
      "query:completion",
      "readiness:Blocked",
      "retryable:false",
      "action:inspectIndex",
    ])).toBe("Index needs inspection before this query can be trusted.");
  });

  it("formats zero-result evidence when readiness is ready", () => {
    expect(formatQueryEnvelopeExplain([
      "query:usages",
      "readiness:Ready",
      "resultCount:0",
    ])).toBe("Indexed query returned no results");
  });

  it("summarizes facade explain fields for diagnostics", () => {
    expect(summarizeQueryEnvelopeExplain([
      "query:definition",
      "used:FileIndex,SDKIndex",
      "skipped:WorkspaceIndex:notReady",
      "resultCount:0",
      "readiness:Partial",
      "requestedGeneration:18",
      "servedGeneration:12",
      "retryable:true",
      "action:waitForIndex",
    ])).toEqual({
      actionId: "waitForIndex",
      action: "Wait for index",
      used: "FileIndex, SDKIndex",
      skipped: "WorkspaceIndex:notReady",
      readiness: "Partial",
      resultCount: "0",
      generation: "12 / 18",
      retryable: "yes",
    });
  });

  it("summarizes backend query event payload explain fields", () => {
    const payloadJson = JSON.stringify({
      explain: [
        "query:definition",
        "used:FileIndex,SDKIndex",
        "skipped:WorkspaceIndex:notReady",
        "resultCount:0",
        "readiness:Blocked",
        "requestedGeneration:18",
        "servedGeneration:12",
        "retryable:false",
        "action:inspectIndex",
      ],
    });

    expect(summarizeQueryEventPayload(payloadJson)).toEqual({
      actionId: "inspectIndex",
      action: "Inspect index",
      used: "FileIndex, SDKIndex",
      skipped: "WorkspaceIndex:notReady",
      readiness: "Blocked",
      resultCount: "0",
      generation: "12 / 18",
      retryable: "no",
    });
    expect(summarizeQueryEventPayload("{broken")).toBeNull();
  });

  it("summarizes recommended action payloads without explain details", () => {
    expect(summarizeQueryEventPayload(JSON.stringify({ recommendedAction: "configureSdk" }))).toEqual({
      actionId: "configureSdk",
      action: "Configure SDK",
      used: null,
      skipped: null,
      readiness: null,
      resultCount: null,
      generation: null,
      retryable: null,
    });
  });

  it("labels actionable query explain controls", () => {
    expect(getQueryExplainActionButtonLabel("waitForIndex")).toBe("Show Processes");
    expect(getQueryExplainActionButtonLabel("inspectIndex")).toBe("Inspect Index");
    expect(getQueryExplainActionButtonLabel("rebuildIndex")).toBe("Rebuild Project Index");
    expect(getQueryExplainActionButtonLabel("configureSdk")).toBe("Configure SDK");
    expect(getQueryExplainActionButtonLabel("useResults")).toBeNull();
  });

  it("builds one newest-first query explain timeline from frontend and backend events", () => {
    const timeline = buildQueryExplainTimeline({
      frontend: [{
        id: "frontend-older",
        kind: "completion",
        query: "Entry.ets:8:4",
        message: "Completion waits for current file symbols",
        explain: ["query:completion", "readiness:Partial", "action:waitForIndex"],
        createdAt: 10,
      }],
      backend: [{
        eventId: "backend-newer",
        rootPath: "/workspace",
        scope: "query",
        kind: "definition",
        phase: "blocked",
        severity: "warning",
        message: "definition query blocked by index readiness",
        taskId: null,
        generation: 18,
        payloadJson: JSON.stringify({
          explain: ["query:definition", "readiness:Blocked", "action:inspectIndex"],
        }),
        createdAt: 20,
      }],
    });

    expect(timeline.map((item) => item.id)).toEqual(["backend-newer", "frontend-older"]);
    expect(timeline[0]).toMatchObject({
      source: "backend",
      title: "backend · warning · definition · blocked",
      message: "definition query blocked by index readiness",
      raw: expect.stringContaining("query:definition"),
    });
    expect(timeline[1]).toMatchObject({
      source: "frontend",
      title: "frontend · info · completion · Entry.ets:8:4",
      raw: "query:completion\nreadiness:Partial\naction:waitForIndex",
    });
  });

  it("adds readable metadata and stable ordering for equal timestamps", () => {
    const timeline = buildQueryExplainTimeline({
      frontend: [{
        id: "frontend-same-time",
        kind: "search",
        query: "Entry",
        message: "Indexed query returned no results",
        explain: ["query:searchEverywhere", "readiness:Ready", "resultCount:0"],
        createdAt: 30,
      }],
      backend: [{
        eventId: "backend-same-time",
        rootPath: "/workspace",
        scope: "query",
        kind: "searchEverywhere",
        phase: "miss",
        severity: "warning",
        message: "searchEverywhere query returned no indexed results",
        taskId: null,
        generation: 30,
        payloadJson: JSON.stringify({
          explain: ["query:searchEverywhere", "readiness:Ready", "resultCount:0"],
        }),
        createdAt: 30,
      }],
    });

    expect(timeline.map((item) => item.id)).toEqual(["backend-same-time", "frontend-same-time"]);
    expect(timeline[0]).toMatchObject({
      source: "backend",
      severity: "warning",
      title: "backend · warning · searchEverywhere · miss",
      displayTime: "30ms",
    });
    expect(timeline[1]).toMatchObject({
      source: "frontend",
      severity: "info",
      title: "frontend · info · search · Entry",
      displayTime: "30ms",
    });
  });

  it("returns null for empty or non-actionable evidence", () => {
    expect(formatQueryEnvelopeExplain()).toBeNull();
    expect(formatQueryEnvelopeExplain(["query:completion", "readiness:Ready"])).toBeNull();
  });
});
