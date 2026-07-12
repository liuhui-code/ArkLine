import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IndexDiagnosticsActiveTaskStrip } from "@/components/layout/IndexDiagnosticsActiveTaskStrip";

describe("IndexDiagnosticsActiveTaskStrip", () => {
  it("shows target path summaries when the active task has file targets", () => {
    render(
      <IndexDiagnosticsActiveTaskStrip
        task={{
          title: "Project index task queued",
          kind: "changed-paths",
          status: "queued",
          progress: "0/1 (0%)",
          duration: "not started",
          detail: "foreground-navigation",
          targetSummary: "src/Entry.ets +2 more",
          targetCurrentFile: false,
        }}
      />,
    );

    const strip = screen.getByRole("status", { name: "Active Index Task" });
    expect(within(strip).getByText("Project index task queued")).toBeVisible();
    expect(within(strip).getByText("src/Entry.ets +2 more")).toBeVisible();
  });

  it("highlights when the active task includes the current file target", () => {
    render(
      <IndexDiagnosticsActiveTaskStrip
        task={{
          title: "Project index task running",
          kind: "changed-paths",
          status: "running",
          progress: "1/2 (50%)",
          duration: "1.0s active",
          detail: "foreground-navigation",
          targetSummary: "src/Entry.ets",
          targetCurrentFile: true,
        }}
      />,
    );

    const strip = screen.getByRole("status", { name: "Active Index Task" });
    expect(within(strip).getByText("Current file · src/Entry.ets")).toBeVisible();
  });
});
