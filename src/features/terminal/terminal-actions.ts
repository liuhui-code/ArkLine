import type { AppSettings } from "@/features/settings/settings-store";
import type { TerminalPreset } from "@/features/terminal/terminal-types";
import type { TerminalRunRequest } from "@/features/workspace/workspace-api";

export function buildManualTerminalRequest(command: string, cwd: string | null, runId: string): TerminalRunRequest {
  return {
    runId,
    command: command.trim(),
    cwd,
    source: "manual",
  };
}

export function buildPresetTerminalRequest(
  preset: TerminalPreset,
  settings: AppSettings,
  cwd: string | null,
  runId: string,
): TerminalRunRequest {
  const command =
    preset === "lint"
      ? settings.validation.lintCommand.trim()
      : preset === "format"
        ? settings.validation.formatCommand.trim()
        : "git status";

  return {
    runId,
    command,
    cwd,
    source: "preset",
  };
}
