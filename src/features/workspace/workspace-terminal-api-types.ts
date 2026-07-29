import type { TerminalSettings } from "@/features/settings/settings-store";

export type TerminalRunRequest = {
  runId: string;
  command: string;
  cwd: string | null;
  source: "preset" | "manual";
  program?: string;
  args?: string[];
  pathEntries?: string[];
  environment?: Record<string, string>;
};

export type TerminalRunResult = {
  runId: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  stopped: boolean;
};

export type TerminalSessionStatus = "starting" | "idle" | "running" | "closed" | "error";

export type TerminalSessionSummary = {
  id: string;
  title: string;
  cwd: string;
  shell: string;
  status: TerminalSessionStatus;
};

export type CreateTerminalSessionRequest = {
  cwd: string | null;
  terminal?: TerminalSettings;
};

export type TerminalProfileResolution = {
  profile: string;
  available: boolean;
  executable: string | null;
  args: string[];
  detail: string;
};

export type TerminalInputWriteRequest = {
  sessionId: string;
  data: string;
};

export type TerminalResizeRequest = {
  sessionId: string;
  cols: number;
  rows: number;
};
