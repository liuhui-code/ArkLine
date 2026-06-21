import type { TerminalRunRequest, TerminalRunResult } from "@/features/workspace/workspace-api";

export type TerminalPreset = "lint" | "format" | "gitStatus";
export type TerminalSessionStatus = "starting" | "idle" | "running" | "closed" | "error";

export type TerminalSessionSummary = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: TerminalSessionStatus;
};

export type TerminalTabsState = {
  sessions: TerminalSessionSummary[];
  activeSessionId: string | null;
};

export type TerminalEntryStatus = "success" | "error" | "stopped";

export type TerminalEntry = {
  id: string;
  runId: string;
  command: string;
  source: TerminalRunRequest["source"];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  stopped: boolean;
  status: TerminalEntryStatus;
};

export type TerminalSessionState = {
  entries: TerminalEntry[];
  input: string;
  history: string[];
  historyIndex: number | null;
  isRunning: boolean;
  currentRunId: string | null;
  currentRequest: TerminalRunRequest | null;
  lastRequest: TerminalRunRequest | null;
};

export type TerminalSessionAction =
  | { type: "setInput"; value: string }
  | { type: "navigateHistory"; direction: "up" | "down" }
  | { type: "startRun"; request: TerminalRunRequest }
  | { type: "finishRun"; result: TerminalRunResult }
  | { type: "clearOutput" };
