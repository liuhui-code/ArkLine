import { describe, expect, it } from "vitest";
import {
  workspaceIndexPublicationRevisions,
  workspaceIndexQueryVersionKey,
  workspaceIndexTaskPublicationFallbackKey,
} from "@/features/workspace/workspace-index-query-publication";
import type { WorkspaceIndexLayerReadinessReport } from "@/features/workspace/workspace-api";

describe("workspace index query publication", () => {
  it("invalidates classes for symbol publications but not content publications", () => {
    const initial = workspaceIndexPublicationRevisions(report({ symbols: 2, content: 4 }));
    const contentPublished = workspaceIndexPublicationRevisions(report({ symbols: 2, content: 5 }));
    const symbolsPublished = workspaceIndexPublicationRevisions(report({ symbols: 3, content: 5 }));

    expect(workspaceIndexQueryVersionKey("catalog:7", "classes", initial)).toBe(
      workspaceIndexQueryVersionKey("catalog:7", "classes", contentPublished),
    );
    expect(workspaceIndexQueryVersionKey("catalog:7", "classes", symbolsPublished)).not.toBe(
      workspaceIndexQueryVersionKey("catalog:7", "classes", contentPublished),
    );
  });

  it("invalidates text for content publications but not symbol publications", () => {
    const initial = workspaceIndexPublicationRevisions(report({ symbols: 2, content: 4 }));
    const symbolsPublished = workspaceIndexPublicationRevisions(report({ symbols: 3, content: 4 }));
    const contentPublished = workspaceIndexPublicationRevisions(report({ symbols: 3, content: 5 }));

    expect(workspaceIndexQueryVersionKey("catalog:7", "text", initial)).toBe(
      workspaceIndexQueryVersionKey("catalog:7", "text", symbolsPublished),
    );
    expect(workspaceIndexQueryVersionKey("catalog:7", "text", contentPublished)).not.toBe(
      workspaceIndexQueryVersionKey("catalog:7", "text", symbolsPublished),
    );
  });

  it("uses terminal task publications only when scoped revisions are unavailable", () => {
    const fallback = workspaceIndexTaskPublicationFallbackKey([{
      taskId: "7:changed-paths",
      rootPath: "/workspace",
      kind: "changed-paths",
      status: "ready",
      reason: "background-refresh",
      generation: 7,
      progressCurrent: 6,
      progressTotal: 6,
    }]);

    expect(workspaceIndexQueryVersionKey("catalog:7", "classes", {}, fallback)).not.toBe(
      workspaceIndexQueryVersionKey("catalog:7", "classes", {}, ""),
    );
    expect(workspaceIndexQueryVersionKey("catalog:7", "classes", { symbols: 2 }, fallback)).toBe(
      workspaceIndexQueryVersionKey("catalog:7", "classes", { symbols: 2 }, ""),
    );
  });
});

function report(revisions: Record<string, number>): WorkspaceIndexLayerReadinessReport {
  return {
    rootPath: "/workspace",
    currentFilePath: null,
    layers: Object.entries(revisions).map(([layer, publicationRevision]) => ({
      layer,
      workspaceStatus: "ready",
      currentFileStatus: null,
      indexedCount: 1,
      failedCount: 0,
      staleCount: 0,
      publicationRevision,
      reason: null,
      recommendedAction: null,
    })),
  };
}
