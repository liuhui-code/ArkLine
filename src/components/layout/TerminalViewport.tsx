import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

type TerminalViewportProps = {
  focusToken: number;
  onInput: (data: string) => void;
  output: string;
  sessionId: string | null;
};

export function TerminalViewport({ focusToken, onInput, output, sessionId }: TerminalViewportProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fallbackBufferRef = useRef("");
  const renderedOutputRef = useRef("");

  function supportsXtermRuntime() {
    const hasCanvas = typeof HTMLCanvasElement !== "undefined"
      && typeof HTMLCanvasElement.prototype.getContext === "function";
    const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";

    return hasCanvas && hasMatchMedia;
  }

  useEffect(() => {
    if (!viewportRef.current || terminalRef.current || !supportsXtermRuntime()) {
      return;
    }

    let disposed = false;
    let cleanup = () => undefined;

    void (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !viewportRef.current) {
        return;
      }

      const terminal = new Terminal({
        cursorBlink: true,
        scrollback: 3000,
        convertEol: true,
      });
      const fitAddon = new FitAddon();

      terminal.loadAddon(fitAddon);
      terminal.open(viewportRef.current);
      fitAddon.fit();
      terminal.write("ArkLine terminal session\r\n");
      const disposable = terminal.onData((data) => {
        void onInput(data);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      cleanup = () => {
        disposable.dispose();
        terminal.dispose();
        terminalRef.current = null;
        fitAddonRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [onInput]);

  useEffect(() => {
    if (sessionId) {
      if (supportsXtermRuntime()) {
        fitAddonRef.current?.fit();
      }
      viewportRef.current?.focus();
    }
  }, [focusToken, sessionId]);

  useEffect(() => {
    if (renderedOutputRef.current === output) {
      return;
    }

    const safeOutput = output ?? "";
    const nextChunk = safeOutput.slice(renderedOutputRef.current.length);
    renderedOutputRef.current = safeOutput;

    if (!nextChunk) {
      return;
    }

    if (supportsXtermRuntime() && terminalRef.current) {
      terminalRef.current.write(nextChunk);
      return;
    }

    if (viewportRef.current) {
      viewportRef.current.textContent = safeOutput;
    }
  }, [output]);

  function handleFallbackKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (supportsXtermRuntime() || !sessionId) {
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const payload = `${fallbackBufferRef.current}\r`;
      fallbackBufferRef.current = "";
      void onInput(payload);
      return;
    }

    if (event.key === "Backspace") {
      event.preventDefault();
      fallbackBufferRef.current = fallbackBufferRef.current.slice(0, -1);
      return;
    }

    if (event.key.length === 1) {
      fallbackBufferRef.current += event.key;
      void onInput(event.key);
    }
  }

  return (
    <div
      ref={viewportRef}
      aria-label="Terminal Viewport"
      className="terminal-tool-window__viewport"
      data-session-id={sessionId ?? ""}
      onKeyDown={handleFallbackKeyDown}
      tabIndex={0}
    />
  );
}
