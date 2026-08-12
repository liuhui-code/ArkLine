import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";

describe("search overlay shell isolation", () => {
  it("does not rerender AppShell while editing a Find in Files query", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.keyboard("{Control>}{Shift>}f{/Shift}{/Control}");
    const query = await screen.findByLabelText("Find in Files Query");
    const rendersBeforeTyping = window.__arklineRenderPressure?.counts.AppShell ?? 0;

    await user.type(query, "EntryAbility");

    expect(window.__arklineRenderPressure?.counts.AppShell ?? 0).toBe(rendersBeforeTyping);
  });

  it("does not rerender AppShell while editing a Quick Open query", async () => {
    const user = userEvent.setup();
    render(<AppShell />);

    await user.keyboard("{Control>}p{/Control}");
    const query = await screen.findByLabelText("Quick Open Query");
    const rendersBeforeTyping = window.__arklineRenderPressure?.counts.AppShell ?? 0;

    await user.type(query, "EntryAbility");

    expect(window.__arklineRenderPressure?.counts.AppShell ?? 0).toBe(rendersBeforeTyping);
  });
});
