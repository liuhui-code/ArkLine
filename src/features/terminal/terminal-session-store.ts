import type { TerminalEntry, TerminalSessionAction, TerminalSessionState } from "@/features/terminal/terminal-types";

export function createTerminalSessionState(): TerminalSessionState {
  return {
    entries: [],
    input: "",
    history: [],
    historyIndex: null,
    isRunning: false,
    currentRunId: null,
    currentRequest: null,
    lastRequest: null,
  };
}

export function terminalSessionReducer(
  state: TerminalSessionState,
  action: TerminalSessionAction,
): TerminalSessionState {
  if (action.type === "setInput") {
    return {
      ...state,
      input: action.value,
      historyIndex: null,
    };
  }

  if (action.type === "navigateHistory") {
    if (state.history.length === 0) {
      return state;
    }

    if (action.direction === "up") {
      const nextIndex = state.historyIndex === null ? state.history.length - 1 : Math.max(0, state.historyIndex - 1);
      return {
        ...state,
        historyIndex: nextIndex,
        input: state.history[nextIndex] ?? state.input,
      };
    }

    if (state.historyIndex === null) {
      return state;
    }

    if (state.historyIndex >= state.history.length - 1) {
      return {
        ...state,
        historyIndex: null,
        input: "",
      };
    }

    const nextIndex = state.historyIndex + 1;
    return {
      ...state,
      historyIndex: nextIndex,
      input: state.history[nextIndex] ?? "",
    };
  }

  if (action.type === "startRun") {
    const command = action.request.command.trim();
    const nextHistory = command ? [...state.history, command] : state.history;

    return {
      ...state,
      input: "",
      history: nextHistory,
      historyIndex: null,
      isRunning: true,
      currentRunId: action.request.runId,
      currentRequest: action.request,
    };
  }

  if (action.type === "finishRun") {
    const status = action.result.stopped
      ? "stopped"
      : action.result.exitCode === 0
        ? "success"
        : "error";
    const entry: TerminalEntry = {
      id: `${action.result.runId}:${state.entries.length}`,
      runId: action.result.runId,
      command: action.result.command,
      source: state.currentRequest?.source ?? "manual",
      stdout: action.result.stdout,
      stderr: action.result.stderr,
      exitCode: action.result.exitCode,
      durationMs: action.result.durationMs,
      stopped: action.result.stopped,
      status,
    };

    return {
      ...state,
      entries: [...state.entries, entry],
      isRunning: false,
      currentRunId: null,
      currentRequest: null,
      lastRequest: state.currentRequest ?? state.lastRequest,
    };
  }

  if (action.type === "clearOutput") {
    return {
      ...state,
      entries: [],
    };
  }

  return state;
}
