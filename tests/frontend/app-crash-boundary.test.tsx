import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppCrashBoundary } from "@/app/AppCrashBoundary";

describe("AppCrashBoundary", () => {
  it("renders a visible crash surface instead of a blank root", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <AppCrashBoundary>
        <ThrowingShell />
      </AppCrashBoundary>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("ArkLine hit a UI error");
    expect(screen.getByText("shell boom")).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

function ThrowingShell(): ReactElement {
  throw new Error("shell boom");
}
