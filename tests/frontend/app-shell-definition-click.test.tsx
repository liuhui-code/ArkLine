import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { vi } from "vitest";
import { AppShell } from "@/components/layout/AppShell";
import { defaultSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type FaultLogRequest = Parameters<NonNullable<WorkspaceApi["listDeviceFaultLogs"]>>[0];
type DeviceLogStreamRequest = Parameters<NonNullable<WorkspaceApi["startDeviceLogStream"]>>[0];

function createWorkspaceApi(overrides: Partial<WorkspaceApi> = {}): WorkspaceApi {
  return {
    pickWorkspaceRoot: async () => null,
    pickPath: async () => null,
    openWorkspace: async (rootPath: string) => ({
      rootName: "DemoWorkspace",
      rootPath,
      files: [`${rootPath}/src/main.ets`],
    }),
    openDemoWorkspace: async () => ({
      rootName: "DemoWorkspace",
      rootPath: "C:/samples/DemoWorkspace",
      files: ["C:/samples/DemoWorkspace/src/main.ets"],
    }),
    openFile: async () => [
      "function submitForm() {",
      "  return true;",
      "}",
      "",
      "submitForm();",
    ].join("\n"),
    saveFile: async () => undefined,
    runValidation: async () => [],
    loadDiff: async () => "",
    inspectEnvironment: async () => ({ tools: [] }),
    loadSettings: async () => defaultSettings(),
    saveSettings: async () => undefined,
    listTerminalSessions: async () => [],
    listDeviceLogDevices: async () => [],
    listDeviceFaultLogs: async (request: FaultLogRequest) => ({
      deviceId: request.deviceId,
      fetchedAt: "2026-07-26T00:00:00.000Z",
      entries: [],
      command: "",
      stderr: "",
      status: "ready",
      message: "ok",
    }),
    startDeviceLogStream: async (request: DeviceLogStreamRequest) => ({
      streamId: "stream-1",
      deviceId: request.deviceId,
      status: "running",
    }),
    stopDeviceLogStream: async () => undefined,
    ...overrides,
  } as unknown as WorkspaceApi;
}

async function openProject(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
  await user.clear(await screen.findByLabelText("Project Path"));
  await user.type(screen.getByLabelText("Project Path"), "C:/samples/DemoWorkspace");
  await user.click(screen.getByRole("button", { name: "Open Project" }));
  const decisionButton = screen.queryByRole("button", { name: "This Window" });
  if (decisionButton) {
    await user.click(decisionButton);
  }
}

describe("AppShell Ctrl+Click definition", () => {
  it("jumps from a clicked function call to its definition target", async () => {
    const user = userEvent.setup();
    const queryDefinitionCandidatesWithReadiness = vi.fn(async () => ({
      items: [{
        path: "C:/samples/DemoWorkspace/src/main.ets",
        line: 1,
        column: 10,
        preview: "function submitForm()",
      }],
      readiness: {
        rootPath: "C:/samples/DemoWorkspace",
        requestedGeneration: 1,
        servedGeneration: 1,
        state: "ready" as const,
        retryable: false,
      },
      explain: ["query:definition", "resultCount:1", "readiness:Ready"],
    }));
    const posAtCoords = vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(51);
    render(<AppShell workspaceApi={createWorkspaceApi({ queryDefinitionCandidatesWithReadiness })} />);

    await openProject(user);
    await user.click(await screen.findByRole("button", { name: "main.ets" }));
    const editor = await screen.findByLabelText("Editor Content", {}, { timeout: 10_000 });
    fireEvent.mouseDown(editor, { ctrlKey: true, button: 0, clientX: 24, clientY: 24 });

    await waitFor(() => expect(queryDefinitionCandidatesWithReadiness).toHaveBeenCalledWith(
      expect.stringMatching(/C:[/\\]samples[/\\]DemoWorkspace/),
      expect.objectContaining({ line: 5, column: 1 }),
    ));
    expect(await screen.findByText("Definition: main.ets:1:10")).toBeVisible();
    posAtCoords.mockRestore();
  });
});
