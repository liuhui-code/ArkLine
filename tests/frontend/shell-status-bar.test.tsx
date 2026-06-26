import { render, screen } from "@testing-library/react";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
import type { SemanticCapabilityState } from "@/features/semantic/semantic-capability-state";

function renderStatusBar(capability: SemanticCapabilityState) {
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
      terminalRunning={false}
      buildMessage="Build idle"
      gitBlameVisible={false}
      gitBlameMenuOpen={false}
      onToggleGitBlameMenu={() => undefined}
      onToggleGitBlame={() => undefined}
      onRefreshGitBlame={() => undefined}
      onShowCurrentLineBlame={() => undefined}
      onCloseGitBlame={() => undefined}
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

    expect(screen.getByText("Index: ready (2 files)")).toBeVisible();
    expect(screen.getByText("SDK: applying")).toBeVisible();
    expect(screen.getByLabelText("SDK Capability")).toHaveAttribute("title", "SDK settings are still applying");
  });
});
