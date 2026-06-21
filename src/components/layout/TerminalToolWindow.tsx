import { TerminalViewport } from "@/components/layout/TerminalViewport";
import type { TerminalSessionSummary } from "@/features/terminal/terminal-types";

type TerminalToolWindowProps = {
  sessions: TerminalSessionSummary[];
  activeSessionId: string | null;
  focusToken: number;
  output: string;
  onInput: (data: string) => void;
  onCreateSession: () => void;
  onCloseSession: (sessionId: string) => void;
  onSetActiveSession: (sessionId: string) => void;
  onClearSession: () => void;
  onStopSession: () => void;
};

export function TerminalToolWindow({
  sessions,
  activeSessionId,
  focusToken,
  output,
  onInput,
  onCreateSession,
  onCloseSession,
  onSetActiveSession,
  onClearSession,
  onStopSession,
}: TerminalToolWindowProps) {
  return (
    <section aria-label="Terminal Panel" className="bottom-tool-window__panel">
      <div className="terminal-tool-window">
        <div className="terminal-tool-window__tabs" role="tablist" aria-label="Terminal Sessions">
          {sessions.map((session) => (
            <div key={session.id} className="terminal-tool-window__tab-shell">
              <button
                type="button"
                role="tab"
                aria-selected={activeSessionId === session.id}
                className={`terminal-tool-window__tab${activeSessionId === session.id ? " terminal-tool-window__tab--active" : ""}`}
                onClick={() => onSetActiveSession(session.id)}
              >
                {session.title}
              </button>
              <button
                type="button"
                aria-label={`Close ${session.title}`}
                className="terminal-tool-window__tab-close"
                onClick={() => onCloseSession(session.id)}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" className="terminal-tool-window__tab-add" onClick={onCreateSession}>
            +
          </button>
        </div>
        <div className="terminal-tool-window__toolbar" role="toolbar" aria-label="Terminal Session Actions">
          <button type="button" className="terminal-tool-window__action" onClick={onClearSession}>Clear</button>
          <button type="button" className="terminal-tool-window__action" onClick={onStopSession}>Stop</button>
        </div>
        <TerminalViewport focusToken={focusToken} output={output} sessionId={activeSessionId} onInput={onInput} />
      </div>
    </section>
  );
}
