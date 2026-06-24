import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal as XTermTerminal } from "@xterm/xterm";
import type { KeyboardEvent } from "react";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { TerminalViewportHandle } from "@/features/terminal/terminal-output-controller";
import "@xterm/xterm/css/xterm.css";

type TerminalViewportProps = {
  focusToken: number;
  layoutToken: number;
  onInput: (data: string) => void;
  sessionId: string | null;
};

export const TerminalViewport = forwardRef<TerminalViewportHandle, TerminalViewportProps>(function TerminalViewport({
  focusToken,
  layoutToken,
  onInput,
  sessionId,
}, ref) {
  const xtermEnabled = supportsXtermRuntime();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTermTerminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const fallbackBufferRef = useRef("");
  const pendingOutputRef = useRef("");
  const pendingFocusRef = useRef(false);

  function supportsXtermRuntime() {
    const hasCanvas = typeof HTMLCanvasElement !== "undefined"
      && typeof HTMLCanvasElement.prototype.getContext === "function";
    const hasMatchMedia = typeof window !== "undefined" && typeof window.matchMedia === "function";

    return hasCanvas && hasMatchMedia;
  }

  useEffect(() => {
    if (!viewportRef.current || terminalRef.current || !xtermEnabled) {
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
      const disposable = terminal.onData((data) => {
        void onInput(data);
      });

      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      if (pendingOutputRef.current) {
        terminal.reset();
        terminal.write(pendingOutputRef.current);
      }
      if (pendingFocusRef.current || sessionId) {
        pendingFocusRef.current = false;
        terminal.focus();
      }
      if (sessionId) {
        terminal.focus();
      }
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
  }, [onInput, sessionId, xtermEnabled]);

  useEffect(() => {
    if (!sessionId) {
      return;
    }

    if (xtermEnabled && terminalRef.current) {
      fitAddonRef.current?.fit();
      terminalRef.current.focus();
      return;
    }

    if (xtermEnabled) {
      pendingFocusRef.current = true;
      return;
    }

    viewportRef.current?.focus();
  }, [focusToken, sessionId]);

  useEffect(() => {
    if (xtermEnabled && terminalRef.current) {
      fitAddonRef.current?.fit();
    }
  }, [layoutToken, xtermEnabled]);

  useImperativeHandle(ref, () => ({
    clear() {
      fallbackBufferRef.current = "";
      pendingOutputRef.current = "";
      if (xtermEnabled && terminalRef.current) {
        terminalRef.current.clear();
        return;
      }

      if (xtermEnabled) {
        return;
      }

      if (viewportRef.current) {
        viewportRef.current.textContent = "";
      }
    },
    focus() {
      if (xtermEnabled && terminalRef.current) {
        terminalRef.current.focus();
        return;
      }

      if (xtermEnabled) {
        pendingFocusRef.current = true;
        return;
      }

      viewportRef.current?.focus();
    },
    reset(output: string) {
      pendingOutputRef.current = output;
      if (xtermEnabled && terminalRef.current) {
        terminalRef.current.reset();
        if (output) {
          terminalRef.current.write(output);
        }
        return;
      }

      if (xtermEnabled) {
        return;
      }

      if (viewportRef.current) {
        viewportRef.current.textContent = output;
      }
    },
    write(data: string) {
      pendingOutputRef.current = `${pendingOutputRef.current}${data}`;
      if (xtermEnabled && terminalRef.current) {
        terminalRef.current.write(data);
        return;
      }

      if (xtermEnabled) {
        return;
      }

      if (viewportRef.current) {
        viewportRef.current.textContent = `${viewportRef.current.textContent ?? ""}${data}`;
      }
    },
  }), [xtermEnabled]);

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
});
