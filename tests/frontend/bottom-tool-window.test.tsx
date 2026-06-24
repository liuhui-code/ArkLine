import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";

describe("Bottom tool window", () => {
  it("shows one active bottom tool window panel at a time", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    expect(screen.getByLabelText("Problems Panel")).toBeVisible();
    expect(screen.queryByLabelText("Terminal Panel")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Terminal" }));

    expect(screen.getByLabelText("Terminal Panel")).toBeVisible();
    expect(screen.queryByLabelText("Problems Panel")).not.toBeInTheDocument();
  });

  it("collapses and restores the bottom content when clicking the active tool tab", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    const terminalTab = screen.getByRole("tab", { name: "Terminal" });
    await user.click(terminalTab);
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByLabelText("Terminal Panel")).toBeVisible();
    expect(terminalTab).toHaveAttribute("aria-selected", "true");

    await user.click(terminalTab);
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByLabelText("Terminal Panel")).not.toBeVisible();
    expect(terminalTab).toHaveAttribute("aria-selected", "true");

    await user.click(terminalTab);
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByLabelText("Terminal Panel")).toBeVisible();
  });

  it("collapses the bottom content from the panel close button without changing the active tool", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole("tab", { name: "Git" }));
    expect(screen.getByLabelText("Git Panel")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Hide Bottom Tool Window" }));

    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByLabelText("Git Panel")).not.toBeVisible();
    expect(screen.getByRole("tab", { name: "Git" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: "Git" }));
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByLabelText("Git Panel")).toBeVisible();
  });

  it("keeps terminal sessions mounted when the bottom content is collapsed", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(screen.getByRole("tab", { name: "Terminal" }));
    const terminalSessions = await screen.findByLabelText("Terminal Sessions");
    expect(within(terminalSessions).getByRole("tab", { name: "pwsh" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Hide Bottom Tool Window" }));
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Terminal Panel")).not.toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Terminal" }));
    expect(within(await screen.findByLabelText("Terminal Sessions")).getByRole("tab", { name: "pwsh" })).toBeVisible();
  });
});
