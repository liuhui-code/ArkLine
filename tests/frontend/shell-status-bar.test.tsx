import { fireEvent, render, screen } from "@testing-library/react";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
import type { SemanticCapabilityState } from "@/features/semantic/semantic-capability-state";

function renderStatusBar(capability: SemanticCapabilityState, overrides: {
  sdkIndexText?: string | null;
  onOpenIndexDiagnostics?: () => void;
} = {}) {
  return render(
    <ShellStatusBar
      activeBottomTool="terminal"
      activePath={null}
      semanticState={{
        provider: "fallback",
        mode: "fallback",
        detail: "Using fallback",
      }}
      semanticCapability={capability}
      statusText="Ready"
      workspaceName="Demo"
      workspaceScanText={null}
      workspaceIndexText="Index: ready (2 files)"
      sdkIndexText={overrides.sdkIndexText ?? null}
      terminalRunning={false}
      buildMessage="Build idle"
      gitBlameVisible={false}
      gitBlameMenuOpen={false}
      onToggleGitBlameMenu={() => undefined}
      onToggleGitBlame={() => undefined}
      onRefreshGitBlame={() => undefined}
      onShowCurrentLineBlame={() => undefined}
      onCloseGitBlame={() => undefined}
      onOpenIndexDiagnostics={overrides.onOpenIndexDiagnostics ?? (() => undefined)}
    />,
  );
}

describe("ShellStatusBar", () => {
  it("shows SDK capability separately from workspace index status", () => {
    renderStatusBar({
      status: "applying",
      semanticNavigation: false,
      semanticCompletion: false,
      localFallback: false,
      message: "SDK settings are still applying",
    });

    expect(screen.getByRole("button", { name: "Open Index Diagnostics: Index: ready (2 files)" })).toBeVisible();
    expect(screen.getByText("SDK: applying")).toBeVisible();
    expect(screen.getByLabelText("SDK Capability")).toHaveAttribute("title", "SDK settings are still applying");
  });

  it("opens index diagnostics from the SDK index status", () => {
    const onOpenIndexDiagnostics = vi.fn();
    renderStatusBar({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    }, {
      sdkIndexText: "SDK API: stalled · No heartbeat > 60s",
      onOpenIndexDiagnostics,
    });

    fireEvent.click(screen.getByRole("button", {
      name: "Open Index Diagnostics: SDK API: stalled · No heartbeat > 60s",
    }));

    expect(onOpenIndexDiagnostics).toHaveBeenCalledTimes(1);
  });
});
