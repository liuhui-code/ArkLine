import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IndexDiagnosticsCenter } from "@/components/layout/IndexDiagnosticsCenter";

describe("IndexDiagnosticsCenter navigation", () => {
  it("exposes section links for fast diagnostics navigation", () => {
    render(
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
      />,
    );

    expect(screen.getByRole("link", { name: "Processes" })).toHaveAttribute("href", "#index-diagnostics-processes");
    expect(screen.getByRole("link", { name: "Health" })).toHaveAttribute("href", "#index-diagnostics-health");
    expect(screen.getByRole("region", { name: "Processes / Queue" })).toHaveAttribute("id", "index-diagnostics-processes");
    expect(screen.getByRole("region", { name: "Health / Storage" })).toHaveAttribute("id", "index-diagnostics-health");
  });
});
