import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { defaultSettings } from "@/features/settings/settings-store";
import type {
  EnvironmentReport,
  TerminalRunRequest,
  TerminalRunResult,
  WorkspaceApi,
  WorkspaceSnapshot,
} from "@/features/workspace/workspace-api";
import { vi } from "vitest";

function createWorkspaceSnapshot(): WorkspaceSnapshot {
  return {
    rootName: "ArkDemo",
    rootPath: "C:/samples/ArkDemo",
    files: ["C:/samples/ArkDemo/entry/src/main/ets/pages/Index.ets"],
  };
}

function createEnvironmentReport(): EnvironmentReport {
  return { tools: [] };
}

function createTerminalResult(request: TerminalRunRequest, overrides: Partial<TerminalRunResult> = {}): TerminalRunResult {
  return {
    runId: "run-1",
    command: request.command,
    stdout: `${request.command} ok`,
    stderr: "",
    exitCode: 0,
    durationMs: 42,
    stopped: false,
    ...overrides,
  };
}

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => null,
    openWorkspace: async () => createWorkspaceSnapshot(),
    openDemoWorkspace: async () => createWorkspaceSnapshot(),
    openFile: async () => "@Entry\n@Component\nstruct Index {}",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => createEnvironmentReport(),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
    runTerminalCommand: async (request) => createTerminalResult(request),
    stopTerminalCommand: async () => undefined,
    ...overrides,
  };
}

describe("Terminal panel", () => {
  it("opens from Alt+F12 and focuses the terminal input", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi()} />);

    await user.keyboard("{Alt>}{F12}{/Alt}");

    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Lint" })).toHaveClass("terminal-panel__tool-button");
    expect(await screen.findByLabelText("Terminal Command")).toHaveFocus();
  });

  it("runs preset and manual commands and renders their output blocks", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(async (request: TerminalRunRequest) =>
      createTerminalResult(request, {
        stdout: request.source === "preset" ? "preset output" : "manual output",
      }),
    );

    render(<AppShell workspaceApi={createWorkspaceApi({ runTerminalCommand })} />);

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    await user.keyboard("{Alt>}{F12}{/Alt}");
    await user.click(screen.getByRole("button", { name: "Lint" }));

    expect(runTerminalCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        source: "preset",
        command: "arklint",
        cwd: "C:\\samples\\ArkDemo",
      }),
    );
    expect(await screen.findByText("preset output")).toBeVisible();
    expect(screen.getByText("preset output").closest(".terminal-entry")).toHaveClass("terminal-entry--success");

    const input = screen.getByLabelText("Terminal Command");
    await user.clear(input);
    await user.type(input, "git status");
    await user.keyboard("{Enter}");

    expect(runTerminalCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        source: "manual",
        command: "git status",
        cwd: "C:\\samples\\ArkDemo",
      }),
    );
    expect(await screen.findByText("manual output")).toBeVisible();
    expect(screen.getByLabelText("Terminal Command")).toHaveClass("terminal-panel__command-input");
  });

  it("supports rerun, clear, command history, and stop", async () => {
    const firstRun = Promise.resolve(
      createTerminalResult({
        runId: "run-1",
        command: "git status",
        cwd: "C:\\samples\\ArkDemo",
        source: "manual",
      }),
    );

    let resolveRunning: ((result: TerminalRunResult) => void) | undefined;
    const runningPromise = new Promise<TerminalRunResult>((resolve) => {
      resolveRunning = resolve;
    });

    const runTerminalCommand = vi
      .fn<WorkspaceApi["runTerminalCommand"]>()
      .mockImplementationOnce(async () => firstRun)
      .mockImplementationOnce(async () => runningPromise)
      .mockImplementationOnce(async (request) => createTerminalResult(request, { stdout: "rerun output" }));
    const stopTerminalCommand = vi.fn(async () => undefined);

    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({ runTerminalCommand, stopTerminalCommand })} />);

    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
    await user.type(await screen.findByLabelText("Project Path"), "C:/samples/ArkDemo");
    await user.click(screen.getByRole("button", { name: "Open Project" }));
    await user.keyboard("{Alt>}{F12}{/Alt}");

    const input = screen.getByLabelText("Terminal Command");
    await user.type(input, "git status");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("git status ok")).toBeVisible();

    await user.type(input, "npm test");
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("button", { name: "Stop" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Run Command" })).toBeDisabled();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByLabelText("Terminal Command")).toHaveValue("npm test");
    await user.keyboard("{ArrowUp}");
    expect(screen.getByLabelText("Terminal Command")).toHaveValue("git status");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByLabelText("Terminal Command")).toHaveValue("npm test");

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(stopTerminalCommand).toHaveBeenCalledWith("run-2");

    if (resolveRunning) {
      resolveRunning(
        createTerminalResult(
          {
            runId: "run-2",
            command: "npm test",
            cwd: "C:\\samples\\ArkDemo",
            source: "manual",
          },
          { stopped: true, exitCode: null, stdout: "", stderr: "stopped" },
        ),
      );
    }

    await waitFor(() => expect(screen.getByText("stopped")).toBeVisible());

    await user.click(screen.getByRole("button", { name: "Rerun" }));
    expect(runTerminalCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: "npm test",
        source: "manual",
      }),
    );
    expect(await screen.findByText("rerun output")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByText("git status ok")).not.toBeInTheDocument();
    expect(screen.queryByText("rerun output")).not.toBeInTheDocument();
    await user.click(screen.getByLabelText("Terminal Command"));
    await user.keyboard("{ArrowUp}");
    expect(screen.getByLabelText("Terminal Command")).toHaveValue("npm test");
  });
});
