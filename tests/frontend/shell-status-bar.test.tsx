import { act, fireEvent, render, screen } from "@testing-library/react";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
import type { SemanticCapabilityState } from "@/features/semantic/semantic-capability-state";
import { createStatusMessageStore } from "@/features/status/status-message-store";

function renderStatusBar(capability: SemanticCapabilityState, overrides: {
  workspaceIndexText?: string;
  sdkIndexText?: string | null;
  onOpenIndexDiagnostics?: (sectionTarget?: string) => void;
  statusMessageStore?: ReturnType<typeof createStatusMessageStore>;
} = {}) {
  const statusMessageStore = overrides.statusMessageStore ?? createStatusMessageStore("Ready");
  const result = render(
    <ShellStatusBar
      activeBottomTool="terminal"
      activePath={null}
      semanticState={{
        provider: "fallback",
        mode: "fallback",
        detail: "Using fallback",
      }}
      semanticCapability={capability}
      statusMessageStore={statusMessageStore}
      workspaceName="Demo"
      workspaceScanText={null}
      workspaceIndexText={overrides.workspaceIndexText ?? "Index: ready (2 files)"}
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
  return { ...result, statusMessageStore };
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

  it("opens index diagnostics at the project process section", () => {
    const onOpenIndexDiagnostics = vi.fn();
    renderStatusBar({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    }, { onOpenIndexDiagnostics });

    fireEvent.click(screen.getByRole("button", { name: "Open Index Diagnostics: Index: ready (2 files)" }));

    expect(onOpenIndexDiagnostics).toHaveBeenCalledWith("index-diagnostics-processes");
  });

  it("opens index diagnostics at the SDK health section", () => {
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

    expect(onOpenIndexDiagnostics).toHaveBeenCalledWith("index-diagnostics-health");
  });

  it("opens index diagnostics at health when project index is backing off", () => {
    const onOpenIndexDiagnostics = vi.fn();
    renderStatusBar({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    }, {
      workspaceIndexText: "Index: Backoff, recommended retry delay 2000ms",
      onOpenIndexDiagnostics,
    });

    fireEvent.click(screen.getByRole("button", {
      name: "Open Index Diagnostics: Index: Backoff, recommended retry delay 2000ms",
    }));

    expect(onOpenIndexDiagnostics).toHaveBeenCalledWith("index-diagnostics-health");
  });

  it("updates only the subscribed status message surface", () => {
    const statusMessageStore = createStatusMessageStore("Ready");
    const ownerRender = vi.fn();
    const capability: SemanticCapabilityState = {
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    };

    function Owner() {
      ownerRender();
      return renderStatusBarElement(capability, statusMessageStore);
    }

    render(<Owner />);
    act(() => statusMessageStore.setMessage("Definition: Entry.ets:8:2"));

    expect(screen.getByText("Definition: Entry.ets:8:2")).toBeVisible();
    expect(ownerRender).toHaveBeenCalledTimes(1);
  });
});

function renderStatusBarElement(
  capability: SemanticCapabilityState,
  statusMessageStore: ReturnType<typeof createStatusMessageStore>,
) {
  return (
    <ShellStatusBar
      activeBottomTool="terminal"
      activePath={null}
      semanticState={{ provider: "fallback", mode: "fallback", detail: "Using fallback" }}
      semanticCapability={capability}
      statusMessageStore={statusMessageStore}
      workspaceName="Demo"
      workspaceScanText={null}
      workspaceIndexText="Index: ready (2 files)"
      sdkIndexText={null}
      terminalRunning={false}
      buildMessage="Build idle"
      gitBlameVisible={false}
      gitBlameMenuOpen={false}
      onToggleGitBlameMenu={() => undefined}
      onToggleGitBlame={() => undefined}
      onRefreshGitBlame={() => undefined}
      onShowCurrentLineBlame={() => undefined}
      onCloseGitBlame={() => undefined}
      onOpenIndexDiagnostics={() => undefined}
    />
  );
}
