import type { KeyboardEvent, RefObject } from "react";
import type { TerminalEntry } from "@/features/terminal/terminal-types";

type TerminalPanelProps = {
  commandInput: string;
  entries: TerminalEntry[];
  isRunning: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChangeInput: (value: string) => void;
  onRunCommand: () => void;
  onRunPreset: (preset: "lint" | "format" | "gitStatus") => void;
  onRerun: () => void;
  onStop: () => void;
  onClear: () => void;
  onHistoryKey: (direction: "up" | "down") => void;
};

function renderExitLabel(entry: TerminalEntry) {
  if (entry.stopped) {
    return "Stopped";
  }

  return entry.exitCode === null ? "Exit: none" : `Exit: ${entry.exitCode}`;
}

export function TerminalPanel({
  commandInput,
  entries,
  isRunning,
  inputRef,
  onChangeInput,
  onRunCommand,
  onRunPreset,
  onRerun,
  onStop,
  onClear,
  onHistoryKey,
}: TerminalPanelProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onHistoryKey("up");
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      onHistoryKey("down");
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onRunCommand();
    }
  }

  return (
    <section aria-label="Terminal Panel" className="bottom-tool-window__panel">
      <div className="terminal-panel">
        <div className="terminal-panel__toolbar" role="toolbar" aria-label="Terminal Actions">
          <button type="button" className="terminal-panel__tool-button" onClick={() => onRunPreset("lint")} disabled={isRunning}>
            Lint
          </button>
          <button type="button" className="terminal-panel__tool-button" onClick={() => onRunPreset("format")} disabled={isRunning}>
            Format
          </button>
          <button type="button" className="terminal-panel__tool-button" onClick={() => onRunPreset("gitStatus")} disabled={isRunning}>
            Git Status
          </button>
          <button type="button" className="terminal-panel__tool-button" onClick={onRerun} disabled={isRunning}>
            Rerun
          </button>
          <button type="button" className="terminal-panel__tool-button" onClick={onStop} disabled={!isRunning}>
            Stop
          </button>
          <button type="button" className="terminal-panel__tool-button" onClick={onClear}>
            Clear
          </button>
        </div>
        <div className="terminal-panel__output" aria-label="Terminal Output">
          {entries.length > 0 ? (
            entries.map((entry) => (
              <article key={entry.id} className={`terminal-entry terminal-entry--${entry.status}`}>
                <div className="terminal-entry__meta">
                  <strong>{entry.command}</strong>
                  <span>{renderExitLabel(entry)}</span>
                  <span>{`${entry.durationMs} ms`}</span>
                </div>
                {entry.stdout ? <pre>{entry.stdout}</pre> : null}
                {entry.stderr ? <pre>{entry.stderr}</pre> : null}
              </article>
            ))
          ) : (
            <p>Run lint, format, git status, or a custom command from the current workspace.</p>
          )}
        </div>
        <div className="terminal-panel__command-row">
          <input
            ref={inputRef}
            aria-label="Terminal Command"
            className="panel-input terminal-panel__command-input"
            value={commandInput}
            placeholder="Run a command in the current workspace"
            onChange={(event) => onChangeInput(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            type="button"
            className="terminal-panel__run-button"
            onClick={onRunCommand}
            disabled={isRunning || commandInput.trim().length === 0}
          >
            Run Command
          </button>
        </div>
      </div>
    </section>
  );
}
