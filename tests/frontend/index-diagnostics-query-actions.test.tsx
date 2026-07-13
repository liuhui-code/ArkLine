import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";
import type { WorkspaceIndexDiagnostics } from "@/features/workspace/workspace-api";

describe("IndexDiagnosticsCenter query explain actions", () => {
  let scrolledElement: Element | null = null;

  beforeEach(() => {
    scrolledElement = null;
    HTMLElement.prototype.scrollIntoView = vi.fn(function scrollIntoView(this: Element) {
      scrolledElement = this;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs project rebuild from a query explain rebuild action", () => {
    const onRebuildProjectIndex = vi.fn();
    renderCenter({
      recentQueryExplains: [{
        id: "query-1",
        kind: "definition",
        query: "Entry.ets:6:49",
        message: "Index data is missing.",
        explain: ["query:definition", "readiness:Blocked", "action:rebuildIndex"],
        createdAt: 1,
      }],
      onRebuildProjectIndex,
    });

    fireEvent.click(screen.getByRole("button", { name: "Rebuild Project Index" }));

    expect(onRebuildProjectIndex).toHaveBeenCalledTimes(1);
  });

  it("opens settings from a backend configure SDK recommendation", () => {
    const onConfigureSdk = vi.fn();
    renderCenter({
      diagnostics: diagnosticsWithQueryPayload({ recommendedAction: "configureSdk" }),
      onConfigureSdk,
    });

    fireEvent.click(screen.getByRole("button", { name: "Configure SDK" }));

    expect(onConfigureSdk).toHaveBeenCalledTimes(1);
  });

  it("routes inspect index to the health section", () => {
    renderCenter({
      diagnostics: diagnosticsWithQueryPayload({
        explain: ["query:definition", "readiness:Blocked", "action:inspectIndex"],
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Inspect Index" }));

    expect(scrolledElement).toBe(screen.getByRole("region", { name: "Health / Storage" }));
  });

  it("routes wait for index to the processes section", () => {
    renderCenter({
      recentQueryExplains: [{
        id: "query-1",
        kind: "completion",
        query: "Entry.ets:8:4",
        message: "Index is still catching up.",
        explain: ["query:completion", "readiness:Partial", "action:waitForIndex"],
        createdAt: 1,
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Processes" }));

    expect(scrolledElement).toBe(screen.getByRole("region", { name: "Processes / Queue" }));
  });

  it("runs current-file indexing from a query explain action", () => {
    const onIndexCurrentFile = vi.fn();
    renderCenter({
      recentQueryExplains: [{
        id: "query-1",
        kind: "definition",
        query: "Entry.ets:6:49",
        message: "Current file index is missing.",
        explain: ["query:definition", "readiness:Blocked", "action:indexCurrentFile"],
        createdAt: 1,
      }],
      onIndexCurrentFile,
    });

    fireEvent.click(screen.getByRole("button", { name: "Index Current File" }));

    expect(onIndexCurrentFile).toHaveBeenCalledTimes(1);
  });

  it("runs SDK rebuild from a query explain action", () => {
    const onRebuildSdkIndex = vi.fn();
    renderCenter({
      diagnostics: diagnosticsWithQueryPayload({
        explain: ["query:completion", "readiness:Blocked", "action:rebuildSdkIndex"],
      }),
      onRebuildSdkIndex,
    });

    fireEvent.click(screen.getByRole("button", { name: "Rebuild SDK Index" }));

    expect(onRebuildSdkIndex).toHaveBeenCalledTimes(1);
  });

  it("routes parser and unresolved import inspections to evidence sections", () => {
    const { rerender } = renderCenter({
      diagnostics: diagnosticsWithQueryPayload({
        explain: ["query:definition", "readiness:Blocked", "action:inspectParserFailures"],
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Show Parser Failures" }));

    expect(scrolledElement).toBe(screen.getByRole("region", { name: "Top Parser Errors" }));

    rerender(
      <IndexDiagnosticsCenter
        open
        loading={false}
        activePath="C:/workspace/src/Entry.ets"
        currentFileDirty={false}
        diagnostics={diagnosticsWithQueryPayload({
          explain: ["query:definition", "readiness:Blocked", "action:inspectUnresolvedImports"],
        })}
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

    fireEvent.click(screen.getByRole("button", { name: "Show Unresolved Imports" }));

    expect(scrolledElement).toBe(screen.getByRole("region", { name: "Unresolved Imports" }));
  });
});

type RenderCenterOptions = Partial<Parameters<typeof IndexDiagnosticsCenter>[0]>;

function renderCenter(overrides: RenderCenterOptions = {}) {
  return render(
    <IndexDiagnosticsCenter
      open
      loading={false}
      activePath="C:/workspace/src/Entry.ets"
      currentFileDirty={false}
      diagnostics={null}
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
      {...overrides}
    />,
  );
}

function diagnosticsWithQueryPayload(payload: Record<string, unknown>): WorkspaceIndexDiagnostics {
  return {
    rootPath: "C:/workspace",
    status: "partial",
    schemaVersions: {},
    schemaVersionActions: [],
    freshnessLayers: [],
    fileCount: 10,
    symbolCount: 20,
    contentLineCount: 30,
    fingerprintCount: 10,
    stubFileCount: 10,
    stubDeclarationCount: 20,
    dependencyEdgeCount: 0,
    unresolvedImportCount: 0,
    parserErrorCount: 0,
    staleGenerationCount: 1,
    sdkSymbolCount: 5,
    discoveryStatus: null,
    discoveredFileCount: 0,
    discoveryExcludedCount: 0,
    discoveryHasMore: false,
    dbSizeBytes: 1024,
    queuePressure: {
      rootPath: "C:/workspace",
      pendingTaskCount: 0,
      workspacePendingTaskCount: 0,
      highestPriority: null,
      highestPriorityTaskKind: null,
    },
    activeSdkPath: null,
    activeSdkVersion: null,
    lastError: null,
    lastExplainStatus: null,
    retryBackoffCount: 0,
    latestRetryBackoff: null,
    repairActions: [],
    parserFailures: [],
    unresolvedImports: [],
    timeline: [],
    recentEvents: [{
      eventId: "query-event",
      rootPath: "C:/workspace",
      scope: "query",
      kind: "definition",
      phase: "blocked",
      severity: "warning",
      message: "definition query blocked by index readiness",
      taskId: null,
      generation: 18,
      payloadJson: JSON.stringify(payload),
      createdAt: 2,
    }],
  };
}
