import { act, fireEvent, render, screen } from "@testing-library/react";
import { ShellStatusBar } from "@/components/layout/ShellStatusBar";
import type { SemanticCapabilityState } from "@/features/semantic/semantic-capability-state";
import { createStatusMessageStore } from "@/features/status/status-message-store";

function renderStatusBar(capability: SemanticCapabilityState, overrides: {
  workspaceIndexText?: string;
  sdkIndexText?: string | null;
  onOpenIndexDiagnostics?: (sectionTarget?: string) => void;
  statusMessageStore?: ReturnType<typeof createStatusMessageStore>;
  backgroundTasks?: Array<{
    id: string;
    title: string;
    detail: string;
    status: "queued" | "running";
    progress: { current: number; total: number } | null;
    cancellable: boolean;
    source: "index" | "build";
  }>;
  onCancelBackgroundTask?: (taskId: string) => void;
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
      backgroundTasks={overrides.backgroundTasks ?? []}
      onCancelBackgroundTask={overrides.onCancelBackgroundTask}
    />,
  );
  return { ...result, statusMessageStore };
}

describe("ShellStatusBar", () => {
  it("shows live index progress as a background task", () => {
    renderStatusBar({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    }, {
      backgroundTasks: [{
        id: "index-project",
        title: "Indexing project",
        detail: "42 of 100 files",
        status: "running",
        progress: { current: 42, total: 100 },
        cancellable: false,
        source: "index",
      }],
    });

    expect(screen.getByRole("button", { name: "Background Tasks: 1 running" })).toHaveTextContent("Indexing project");
    expect(screen.getByRole("progressbar", { name: "Indexing project progress" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeVisible();
  });

  it("expands concurrent background tasks from the compact status control", () => {
    renderStatusBar({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    }, {
      backgroundTasks: [{
        id: "index-project",
        title: "Indexing project",
        detail: "42 of 100 files",
        status: "running",
        progress: { current: 42, total: 100 },
        cancellable: false,
        source: "index",
      }, {
        id: "build-current",
        title: "Building project",
        detail: "Running Hvigor",
        status: "running",
        progress: null,
        cancellable: true,
        source: "build",
      }],
    });

    fireEvent.click(screen.getByRole("button", { name: "Background Tasks: 2 running" }));

    const taskCenter = screen.getByRole("dialog", { name: "Background Tasks" });
    expect(taskCenter).toHaveTextContent("Indexing project");
    expect(taskCenter).toHaveTextContent("Building project");
    expect(taskCenter).toHaveTextContent("Running Hvigor");
  });

  it("offers cancellation only for cancellable background work", () => {
    const onCancelBackgroundTask = vi.fn();
    renderStatusBar({
      status: "semantic",
      semanticNavigation: true,
      semanticCompletion: true,
      localFallback: true,
      message: "SDK ready",
    }, {
      backgroundTasks: [{
        id: "index-project",
        title: "Indexing project",
        detail: "42 of 100 files",
        status: "running",
        progress: { current: 42, total: 100 },
        cancellable: false,
        source: "index",
      }, {
        id: "build-current",
        title: "Building project",
        detail: "Running Hvigor",
        status: "running",
        progress: null,
        cancellable: true,
        source: "build",
      }],
      onCancelBackgroundTask,
    });

    fireEvent.click(screen.getByRole("button", { name: "Background Tasks: 2 running" }));
    expect(screen.queryByRole("button", { name: "Cancel Indexing project" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel Building project" }));
    expect(onCancelBackgroundTask).toHaveBeenCalledWith("build-current");
  });

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

  it("shows repository changes and branch divergence in the branch control", () => {
    const onOpenGitBranchPicker = vi.fn();
    render(
      <ShellStatusBar
        activeBottomTool="git"
        activePath={null}
        semanticState={{ provider: "fallback", mode: "fallback", detail: "Using fallback" }}
        semanticCapability={{ status: "semantic", semanticNavigation: true, semanticCompletion: true, localFallback: true, message: "SDK ready" }}
        statusMessageStore={createStatusMessageStore("Ready")}
        workspaceName="Demo"
        gitBranchName="feature/git"
        gitChangeCount={4}
        gitAhead={2}
        gitBehind={1}
        workspaceScanText={null}
        workspaceIndexText="Index: ready"
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
        onOpenGitBranchPicker={onOpenGitBranchPicker}
      />,
    );

    const branch = screen.getByRole("button", { name: "Switch Git Branch: feature/git, 4 changes, 2 ahead, 1 behind" });
    expect(branch).toHaveTextContent("Git: feature/git · 4 · ↑2 ↓1");
    fireEvent.click(branch);
    expect(onOpenGitBranchPicker).toHaveBeenCalledOnce();
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
