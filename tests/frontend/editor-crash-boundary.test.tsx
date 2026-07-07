import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { EditorCrashBoundary } from "@/components/layout/EditorCrashBoundary";

describe("EditorCrashBoundary", () => {
  it("keeps the shell visible when the editor subtree crashes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <EditorCrashBoundary resetKey="/workspace/A.ets">
        <ThrowingEditor />
      </EditorCrashBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Editor view crashed");
    consoleError.mockRestore();
  });

  it("recovers when the active editor path changes", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { rerender } = render(
      <EditorCrashBoundary resetKey="/workspace/A.ets">
        <ThrowingEditor />
      </EditorCrashBoundary>,
    );

    rerender(
      <EditorCrashBoundary resetKey="/workspace/B.ets">
        <div>Recovered editor</div>
      </EditorCrashBoundary>,
    );

    expect(screen.getByText("Recovered editor")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

function ThrowingEditor(): ReactElement {
  throw new Error("boom");
}
