import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "File" }));
  await user.click(await screen.findByRole("menuitem", { name: "Open Project..." }));
  await user.type(await screen.findByLabelText("Project Path"), "C:/samples/DemoWorkspace");
  await user.click(screen.getByRole("button", { name: "Open Project" }));
  await user.click(await screen.findByRole("button", { name: "main.ets" }));
  return screen.findByLabelText("Editor Content");
}

describe("Shell hotkeys", () => {
  it("closes Quick Open with Escape and returns focus to the editor", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(await openEditor(user));
    await user.keyboard("{Control>}p{/Control}");

    expect(await screen.findByLabelText("Quick Open Overlay")).toBeVisible();

    await user.keyboard("{Escape}");

    expect(screen.queryByLabelText("Quick Open Overlay")).not.toBeInTheDocument();
    expect(await screen.findByLabelText("Editor Content")).toHaveFocus();
  });

  it("hides the focused bottom tool window with Shift+Escape", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await openEditor(user);
    await user.click(screen.getByRole("tab", { name: "Terminal" }));

    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();

    await user.keyboard("{Shift>}{Escape}{/Shift}");

    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.queryByLabelText("Terminal Panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
    expect(await screen.findByLabelText("Editor Content")).toHaveFocus();
  });

  it("switches into editor-only mode and restores tool windows with IDEA-style shortcuts", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(await openEditor(user));

    expect(screen.getByRole("region", { name: "Files" })).toBeVisible();
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();

    await user.keyboard("{Control>}{Shift>}{F12}{/Shift}{/Control}");

    expect(screen.queryByRole("region", { name: "Files" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Search" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.queryByLabelText("Problems Panel")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Editor Content")).toHaveFocus();

    await user.keyboard("{Alt>}1{/Alt}");
    expect(screen.getByRole("region", { name: "Files" })).toBeVisible();

    await user.keyboard("{Alt>}{F12}{/Alt}");
    expect(screen.getByLabelText("Bottom Tool Window")).toBeVisible();
    expect(screen.getByRole("tab", { name: "Terminal" })).toHaveAttribute("aria-selected", "true");
  });

  it("opens the usages tool window with Alt+F7", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(await openEditor(user));
    await user.keyboard("{Alt>}{F7}{/Alt}");

    expect(await screen.findByRole("tab", { name: "Usages" })).toHaveAttribute("aria-selected", "true");
  });

  it("closes the active editor tab with Ctrl+W instead of closing the window", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.click(await openEditor(user));
    await user.keyboard("{Control>}p{/Control}");
    await user.click(await screen.findByRole("button", { name: "C:\\samples\\DemoWorkspace\\AppScope\\app.json5" }));

    expect(await screen.findByRole("button", { name: "app.json5", pressed: true })).toBeVisible();
    expect(screen.getByRole("button", { name: "main.ets", pressed: false })).toBeVisible();

    await user.keyboard("{Control>}w{/Control}");

    expect(screen.queryByRole("button", { name: "app.json5", pressed: true })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "main.ets", pressed: true })).toBeVisible();
    expect(await screen.findByLabelText("Editor Content")).toHaveFocus();
  });
});
