import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

async function openProject(user: ReturnType<typeof userEvent.setup>, path = "/workspace/Demo") {
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
  await user.clear(await screen.findByLabelText("Project Path"));
  await user.type(screen.getByLabelText("Project Path"), path);
  await user.click(screen.getByRole("button", { name: "Open Project" }));
  const thisWindow = screen.queryByRole("button", { name: "This Window" });
  if (thisWindow) {
    await user.click(thisWindow);
  }
}

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => "/workspace/Demo",
    openWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: [
        "/workspace/Demo/build-profile.json5",
        "/workspace/Demo/oh-package.json5",
        "/workspace/Demo/hvigorfile.ts",
        "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
      ],
    }),
    openDemoWorkspace: async () => ({
      rootName: "Demo",
      rootPath: "/workspace/Demo",
      files: ["/workspace/Demo/entry/src/main/ets/pages/Index.ets"],
    }),
    openFile: async () => "",
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
    runTerminalCommand: async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      exitCode: 0,
      durationMs: 42,
      stopped: false,
    }),
    stopTerminalCommand: async () => undefined,
    createTerminalSession: async () => ({ id: "session-1", title: "zsh", cwd: "/workspace/Demo", shell: "zsh", status: "idle" }),
    listTerminalSessions: async () => [],
    writeTerminalInput: async () => undefined,
    resizeTerminalSession: async () => undefined,
    closeTerminalSession: async () => undefined,
    stopTerminalSession: async () => undefined,
    ...overrides,
  };
}

describe("build tool window", () => {
  it("runs a HAP build from the top bar and shows success status", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({ runTerminalCommand })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    expect(await screen.findByRole("tab", { name: "Build" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon",
      cwd: "/workspace/Demo",
      source: "preset",
    })));
    expect(screen.getAllByText("Build succeeded").length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Build Status")).toHaveTextContent("Build succeeded");
  });

  it("parses build diagnostics into Problems after a failed build", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
        exitCode: 1,
        durationMs: 90,
        stopped: false,
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));
    await waitFor(() => expect(screen.getAllByText("Build failed").length).toBeGreaterThan(0));
    await user.click(screen.getByRole("tab", { name: "Problems" }));

    expect(screen.getByText("Property width does not exist.")).toBeInTheDocument();
    expect(within(screen.getByLabelText("Problems List")).getByText("build")).toBeInTheDocument();
  });

  it("lets the user stop a running build", async () => {
    const user = userEvent.setup();
    let resolveRun: ((value: Awaited<ReturnType<WorkspaceApi["runTerminalCommand"]>>) => void) | null = null;
    const stopTerminalCommand = vi.fn(async () => undefined);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand: (request) => new Promise((resolve) => {
        resolveRun = resolve;
        void request;
      }),
      stopTerminalCommand,
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("button", { name: "Run Build" }));
    await user.click(await screen.findByRole("button", { name: "Stop Build" }));

    expect(stopTerminalCommand).toHaveBeenCalled();
    await act(async () => {
      resolveRun?.({
        runId: "build-1",
        command: "",
        stdout: "",
        stderr: "",
        exitCode: null,
        durationMs: 10,
        stopped: true,
      });
    });
  });

  it("uses the active file module for HAP builds", async () => {
    const user = userEvent.setup();
    const runTerminalCommand = vi.fn(createWorkspaceApi().runTerminalCommand);
    render(<AppShell workspaceApi={createWorkspaceApi({
      runTerminalCommand,
      openWorkspace: async () => ({
        rootName: "Demo",
        rootPath: "/workspace/Demo",
        files: [
          "/workspace/Demo/build-profile.json5",
          "/workspace/Demo/hvigorfile.ts",
          "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
        ],
      }),
    })} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "Feature.ets" }));
    await user.click(screen.getByRole("button", { name: "Run Build" }));

    await waitFor(() => expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      command: "./hvigorw assembleHap --mode module -p module=feature@default -p product=default -p buildMode=debug --no-daemon",
    })));
  });

  it("shows detected modules as module choices", async () => {
    const user = userEvent.setup();
    render(<AppShell workspaceApi={createWorkspaceApi({
      openWorkspace: async () => ({
        rootName: "Demo",
        rootPath: "/workspace/Demo",
        files: [
          "/workspace/Demo/build-profile.json5",
          "/workspace/Demo/hvigorfile.ts",
          "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
        ],
      }),
    })} />);

    await openProject(user);
    await user.click(screen.getByRole("tab", { name: "Build" }));

    const moduleSelect = await screen.findByLabelText("Build Module");
    expect(within(moduleSelect).getByRole("option", { name: "entry" })).toBeInTheDocument();
    expect(within(moduleSelect).getByRole("option", { name: "feature" })).toBeInTheDocument();
  });
});
