import { useReducer, useRef } from "react";
import type { AppSettings } from "@/features/settings/settings-store";
import { buildManualTerminalRequest, buildPresetTerminalRequest } from "@/features/terminal/terminal-actions";
import { createTerminalSessionState, terminalSessionReducer } from "@/features/terminal/terminal-session-store";
import type { TerminalPreset } from "@/features/terminal/terminal-types";
import type { TerminalRunRequest, TerminalRunResult, WorkspaceApi } from "@/features/workspace/workspace-api";

type UseTerminalSessionOptions = {
  settings: AppSettings;
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
  onStatusChange: (status: string) => void;
};

export function useTerminalSession({
  settings,
  workspaceApi,
  workspaceRootPath,
  onStatusChange,
}: UseTerminalSessionOptions) {
  const [terminalState, dispatchTerminal] = useReducer(terminalSessionReducer, undefined, createTerminalSessionState);
  const terminalInputRef = useRef<HTMLInputElement | null>(null);
  const terminalRunCounterRef = useRef(0);

  function focusTerminalInput() {
    window.setTimeout(() => terminalInputRef.current?.focus(), 0);
  }

  function nextTerminalRunId() {
    terminalRunCounterRef.current += 1;
    return `run-${terminalRunCounterRef.current}`;
  }

  async function runTerminalRequest(request: TerminalRunRequest) {
    if (!request.command.trim() || terminalState.isRunning) {
      return;
    }

    dispatchTerminal({ type: "startRun", request });
    onStatusChange(`Terminal: Running ${request.command}`);

    try {
      const result = await workspaceApi.runTerminalCommand(request);
      dispatchTerminal({
        type: "finishRun",
        result: {
          ...result,
          runId: result.runId || request.runId,
        },
      });

      if (result.stopped) {
        onStatusChange("Terminal: Stopped");
      } else if (result.exitCode === 0) {
        onStatusChange("Terminal: Succeeded");
      } else {
        onStatusChange(`Terminal: Failed (exit ${result.exitCode ?? "?"})`);
      }
    } catch (error) {
      const failedResult: TerminalRunResult = {
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
        durationMs: 0,
        stopped: false,
      };
      dispatchTerminal({ type: "finishRun", result: failedResult });
      onStatusChange("Terminal: Failed");
    }
  }

  function runPresetTerminalCommand(preset: TerminalPreset) {
    const request = buildPresetTerminalRequest(preset, settings, workspaceRootPath, nextTerminalRunId());
    void runTerminalRequest(request);
  }

  function runManualTerminalCommand() {
    const request = buildManualTerminalRequest(terminalState.input, workspaceRootPath, nextTerminalRunId());
    void runTerminalRequest(request);
  }

  function rerunLastTerminalCommand() {
    if (!terminalState.lastRequest || terminalState.isRunning) {
      return;
    }

    const nextRequest: TerminalRunRequest = {
      ...terminalState.lastRequest,
      runId: nextTerminalRunId(),
    };
    void runTerminalRequest(nextRequest);
  }

  async function stopRunningTerminalCommand() {
    if (!terminalState.currentRunId) {
      return;
    }

    await workspaceApi.stopTerminalCommand(terminalState.currentRunId);
  }

  return {
    terminalInputRef,
    terminalState,
    focusTerminalInput,
    setInput: (value: string) => dispatchTerminal({ type: "setInput", value }),
    navigateHistory: (direction: "up" | "down") => dispatchTerminal({ type: "navigateHistory", direction }),
    clearOutput: () => dispatchTerminal({ type: "clearOutput" }),
    runPresetTerminalCommand,
    runManualTerminalCommand,
    rerunLastTerminalCommand,
    stopRunningTerminalCommand,
  };
}
