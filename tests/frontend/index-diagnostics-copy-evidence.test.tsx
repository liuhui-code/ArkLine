import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter copy evidence", () => {
  it("copies a structured index diagnostics evidence report", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnostics()}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[{
          id: "query-1",
          kind: "search",
          query: "Entry",
          message: "Search completed",
          explain: [
            "searchedFiles:7",
            "prefilterSkippedFiles:3",
            "limitReached:false",
            "resultCount:2",
            "readiness:Partial",
            "servedGeneration:4",
            "requestedGeneration:6",
            "retryable:true",
            "used:TextIndex",
            "skipped:SDKIndex",
          ],
          createdAt: 1,
        }]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Evidence" }));

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("# ArkLine Index Diagnostics Evidence"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("workspace: /workspace"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("activePath: /workspace/src/Entry.ets"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("freshness: content ready=8 stale=1 missing=1 expectedVersion=2"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("readiness=Partial generation=4 / 6 retryable=yes used=TextIndex skipped=SDKIndex"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("metrics=searched 7 file(s), skipped 3 prefiltered file(s), limit reached: no"));
    expect(await screen.findByText("Evidence copied")).toBeVisible();
  });

  it("reports clipboard write failures without closing diagnostics", async () => {
    const writeText = vi.fn(async () => {
      throw new Error("denied");
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnostics()}
        fileReadiness={null}
        layerReadiness={null}
        recentQueryExplains={[]}
        taskStatuses={[]}
        onClose={vi.fn()}
        onRefresh={vi.fn()}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy Evidence" }));

    expect(await screen.findByText("Copy failed")).toBeVisible();
  });
});

function diagnostics(): WorkspaceIndexDiagnostics {
  return {
    rootPath: "/workspace",
    status: "partial",
    schemaVersions: {},
    schemaVersionActions: [],
    freshnessLayers: [
      {
        layer: "content",
        readyCount: 8,
        staleCount: 1,
        missingCount: 1,
        expectedVersion: 2,
      },
    ],
    fileCount: 10,
    symbolCount: 20,
    contentLineCount: 30,
    fingerprintCount: 10,
    stubFileCount: 10,
    stubDeclarationCount: 20,
    dependencyEdgeCount: 0,
    unresolvedImportCount: 1,
    parserErrorCount: 2,
    staleGenerationCount: 3,
    sdkSymbolCount: 4,
    discoveryStatus: null,
    discoveredFileCount: 0,
    discoveryExcludedCount: 0,
    discoveryHasMore: false,
    dbSizeBytes: 1024,
    queuePressure: {
      rootPath: "/workspace",
      pendingTaskCount: 0,
      workspacePendingTaskCount: 0,
      highestPriority: null,
      highestPriorityTaskKind: null,
    },
    activeSdkPath: null,
    activeSdkVersion: null,
    lastError: null,
    lastExplainStatus: "miss",
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    repairActions: ["rebuildProjectIndex"],
    parserFailures: [],
    unresolvedImports: [],
    timeline: [],
    recentEvents: [],
  };
}
