import { useEffect, useRef } from "react";

type TerminalViewportProps = {
  focusToken: number;
  sessionId: string | null;
};

export function TerminalViewport({ focusToken, sessionId }: TerminalViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (sessionId) {
      viewportRef.current?.focus();
    }
  }, [focusToken, sessionId]);

  return (
    <div
      ref={viewportRef}
      aria-label="Terminal Viewport"
      className="terminal-tool-window__viewport"
      data-session-id={sessionId ?? ""}
      tabIndex={0}
    />
  );
}
