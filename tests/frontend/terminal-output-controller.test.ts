import { describe, expect, it, vi } from "vitest";
import { createTerminalOutputController } from "@/features/terminal/terminal-output-controller";

function createViewport() {
  return {
    write: vi.fn(),
    reset: vi.fn(),
    clear: vi.fn(),
    focus: vi.fn(),
  };
}

describe("terminal output controller", () => {
  it("writes active-session output directly to the attached viewport", () => {
    const controller = createTerminalOutputController();
    const viewport = createViewport();

    controller.attachViewport(viewport);
    controller.activateSession("session-1");
    controller.handleOutput("session-1", "pwd\r\n");

    expect(viewport.write).toHaveBeenCalledWith("pwd\r\n");
    expect(controller.getBufferedOutput("session-1")).toBe("pwd\r\n");
  });

  it("buffers inactive-session output and restores it when that session becomes active", () => {
    const controller = createTerminalOutputController();
    const viewport = createViewport();

    controller.attachViewport(viewport);
    controller.activateSession("session-1");
    controller.handleOutput("session-2", "npm test\r\n");

    expect(viewport.write).not.toHaveBeenCalled();

    controller.activateSession("session-2");

    expect(viewport.reset).toHaveBeenCalledWith("npm test\r\n");
  });

  it("clears the active viewport and buffered output for the selected session", () => {
    const controller = createTerminalOutputController();
    const viewport = createViewport();

    controller.attachViewport(viewport);
    controller.activateSession("session-1");
    controller.handleOutput("session-1", "ls\r\n");

    controller.clearSession("session-1");

    expect(viewport.clear).toHaveBeenCalled();
    expect(controller.getBufferedOutput("session-1")).toBe("");
  });
});
