import { render, screen } from "@testing-library/react";
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
});
