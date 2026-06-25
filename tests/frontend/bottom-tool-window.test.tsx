import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppShell } from "@/components/layout/AppShell";
import { defaultWorkspaceApi } from "@/features/workspace/workspace-api";
import { readFileSync } from "node:fs";

const appCss = readFileSync("src/styles/app.css", "utf8");

if (typeof window.PointerEvent === "undefined") {
  window.PointerEvent = MouseEvent as typeof PointerEvent;
}

let appStyleElement: HTMLStyleElement;

beforeAll(() => {
  appStyleElement = document.createElement("style");
  appStyleElement.textContent = extractStyleRules([
    ".bottom-tool-window__panel",
    ".bottom-tool-window__panel--git",
    ".git-tool-window",
    ".git-tool-window__sidebar",
    ".git-tool-window__viewer",
  ]).join("\n");
  document.head.append(appStyleElement);
});

afterAll(() => {
  appStyleElement.remove();
});

function extractStyleRules(targetSelectors: string[]) {
  const rules = [...appCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter((match) => {
      const selectors = match[1].split(",").map((selector) => selector.trim());
      return targetSelectors.some((targetSelector) => selectors.includes(targetSelector));
    })
    .map((match) => `${match[1]} {${match[2]}}`);

  expect(rules.join("\n")).toContain(".git-tool-window");

  return rules;
}

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

  it("resizes the bottom panel by dragging the resize separator", async () => {
    render(<AppShell />);

    const bottomPanel = screen.getByLabelText("Bottom Tool Window");
    const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

    expect(bottomPanel).toHaveStyle({ height: "280px" });

    await act(async () => {
      fireEvent.pointerDown(separator, { pointerId: 1, clientY: 500 });
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 420 });
      fireEvent.pointerUp(window, { pointerId: 1, clientY: 420 });
    });

    expect(bottomPanel).toHaveStyle({ height: "360px" });
  });

  it("keeps Git content inside the resized bottom panel", async () => {
    const user = userEvent.setup();
    const workspaceApi = {
      ...defaultWorkspaceApi,
      loadDiff: async () => `diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,1 @@
-old
+new`,
    };

    render(<AppShell workspaceApi={workspaceApi} />);

    const header = screen.getByRole("banner", { name: "Application Header" });
    await user.click(within(header).getByRole("button", { name: "View" }));
    await user.click(await screen.findByRole("menuitem", { name: "Git" }));
    const bottomPanel = screen.getByLabelText("Bottom Tool Window");
    const gitPanel = await screen.findByLabelText("Git Panel");
    await screen.findByLabelText("Git Diff Viewer");
    const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

    await act(async () => {
      fireEvent.pointerDown(separator, { pointerId: 1, clientY: 500 });
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 450 });
      fireEvent.pointerUp(window, { pointerId: 1, clientY: 450 });
    });

    expect(bottomPanel).toHaveStyle({ height: "330px" });
    expect(gitPanel).toBeVisible();

    const gitToolWindow = gitPanel.querySelector(".git-tool-window");
    const gitSidebar = gitPanel.querySelector(".git-tool-window__sidebar");
    const gitViewer = gitPanel.querySelector(".git-tool-window__viewer");

    expect(gitToolWindow).toBeInstanceOf(HTMLElement);
    expect(gitSidebar).toBeInstanceOf(HTMLElement);
    expect(gitViewer).toBeInstanceOf(HTMLElement);

    const gitToolStyle = window.getComputedStyle(gitToolWindow as HTMLElement);
    const gitSidebarStyle = window.getComputedStyle(gitSidebar as HTMLElement);
    const gitViewerStyle = window.getComputedStyle(gitViewer as HTMLElement);

    expect(gitToolStyle.display).toBe("grid");
    expect(gitToolStyle.height).toBe("100%");
    expect(["0", "0px"]).toContain(gitToolStyle.minHeight);
    expect(gitSidebarStyle.overflow).toBe("auto");
    expect(["0", "0px"]).toContain(gitSidebarStyle.minHeight);
    expect(gitViewerStyle.overflow).toBe("auto");
    expect(["0", "0px"]).toContain(gitViewerStyle.minHeight);
  });

  it("clamps bottom panel resize height to min and max bounds", async () => {
    render(<AppShell />);

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    const bottomPanel = screen.getByLabelText("Bottom Tool Window");
    const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

    await act(async () => {
      fireEvent.pointerDown(separator, { pointerId: 1, clientY: 500 });
      fireEvent.pointerMove(window, { pointerId: 1, clientY: 800 });
      fireEvent.pointerUp(window, { pointerId: 1, clientY: 800 });
    });
    expect(bottomPanel).toHaveStyle({ height: "160px" });

    await act(async () => {
      fireEvent.pointerDown(separator, { pointerId: 2, clientY: 500 });
      fireEvent.pointerMove(window, { pointerId: 2, clientY: 0 });
      fireEvent.pointerUp(window, { pointerId: 2, clientY: 0 });
    });
    expect(bottomPanel).toHaveStyle({ height: "560px" });
  });

  it("toggles between default and maximum height when double-clicking the resize separator", async () => {
    render(<AppShell />);

    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    const bottomPanel = screen.getByLabelText("Bottom Tool Window");
    const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

    await act(async () => {
      fireEvent.doubleClick(separator);
    });
    expect(bottomPanel).toHaveStyle({ height: "560px" });

    await act(async () => {
      fireEvent.doubleClick(separator);
    });
    expect(bottomPanel).toHaveStyle({ height: "280px" });
  });

  it("resizes the bottom panel from the keyboard separator controls", async () => {
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 800 });
    render(<AppShell />);
    const bottomPanel = screen.getByLabelText("Bottom Tool Window");
    const separator = screen.getByRole("separator", { name: "Resize Bottom Tool Window" });

    expect(separator).toHaveAttribute("aria-valuemin", "160");
    expect(separator).toHaveAttribute("aria-valuemax", "560");
    expect(separator).toHaveAttribute("aria-valuenow", "280");

    await act(async () => { fireEvent.keyDown(separator, { key: "ArrowUp" }); });
    expect(bottomPanel).toHaveStyle({ height: "290px" });
    expect(separator).toHaveAttribute("aria-valuenow", "290");

    await act(async () => { fireEvent.keyDown(separator, { key: "End" }); });
    expect(bottomPanel).toHaveStyle({ height: "560px" });
    expect(separator).toHaveAttribute("aria-valuenow", "560");

    await act(async () => { fireEvent.keyDown(separator, { key: "Home" }); });
    expect(bottomPanel).toHaveStyle({ height: "160px" });
  });

  it("includes Device Log as a bottom tool tab", () => {
    render(<AppShell />);

    expect(screen.getByRole("tab", { name: "Device Log" })).toBeVisible();
  });
});
