import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { IndexDiagnosticsHealthSection } from "@/components/layout/IndexDiagnosticsHealthSection";
import { diagnostics as createDiagnostics } from "./index-diagnostics-controller-test-fixtures";

describe("IndexDiagnosticsHealthSection shared SDK storage", () => {
  it("renders artifact retention and connection lifecycle evidence", () => {
    const diagnostics = createDiagnostics();
    diagnostics.sharedSdkReadyArtifactCount = 2;
    diagnostics.sharedSdkBuildingArtifactCount = 1;
    diagnostics.sharedSdkFailedArtifactCount = 0;
    diagnostics.sharedSdkReferenceCount = 3;
    diagnostics.sharedSdkDbSizeBytes = 32 * 1024 * 1024;
    diagnostics.sharedSdkWalSizeBytes = 4 * 1024 * 1024;
    diagnostics.sharedSdkFreelistBytes = 2 * 1024 * 1024;
    diagnostics.sharedSdkStoreRevision = 8;
    diagnostics.sharedSdkStoreGeneration = 1;
    diagnostics.sharedSdkActiveReaderCount = 2;
    diagnostics.sharedSdkLastMaintenanceAt = 42;
    diagnostics.sharedSdkLastDeletedArtifactCount = 4;

    render(
      <IndexDiagnosticsHealthSection
        diagnostics={diagnostics}
        dbSize="1.00 KB"
        schemaRebuildActions={[]}
        repairActions={[]}
        activeProjectTask={null}
        activeSdkTask={null}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const health = screen.getByRole("region", { name: "Health / Storage" });
    expect(metric(health, "Shared SDK artifacts")).toHaveTextContent(
      "2 ready / 1 building / 0 failed",
    );
    expect(metric(health, "Shared SDK references")).toHaveTextContent("3");
    expect(metric(health, "Shared SDK DB size")).toHaveTextContent("32.0 MB");
    expect(metric(health, "Shared SDK WAL size")).toHaveTextContent("4.0 MB");
    expect(metric(health, "Shared SDK reclaimable")).toHaveTextContent("2.0 MB");
    expect(metric(health, "Shared SDK revision / generation")).toHaveTextContent("8 / 1");
    expect(metric(health, "Shared SDK readers")).toHaveTextContent("2");
    expect(metric(health, "Shared SDK last cleanup")).toHaveTextContent("4 artifacts removed");
  });

  it("reports that cleanup has not run when the store has no maintenance record", () => {
    const diagnostics = createDiagnostics();

    render(
      <IndexDiagnosticsHealthSection
        diagnostics={diagnostics}
        dbSize="0 B"
        schemaRebuildActions={[]}
        repairActions={[]}
        activeProjectTask={null}
        activeSdkTask={null}
        onResumeIndexing={vi.fn()}
        onRebuildProjectIndex={vi.fn()}
        onRebuildSdkIndex={vi.fn()}
        onConfigureSdk={vi.fn()}
      />,
    );

    const health = screen.getByRole("region", { name: "Health / Storage" });
    expect(metric(health, "Shared SDK last cleanup")).toHaveTextContent("never");
  });
});

function metric(region: HTMLElement, label: string): Element {
  const value = within(region).getByText(label).nextElementSibling;
  if (!value) {
    throw new Error(`Missing metric value for ${label}`);
  }
  return value;
}
