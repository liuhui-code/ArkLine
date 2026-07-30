import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitToolWindow } from "@/components/layout/GitToolWindow";
import { parseUnifiedDiff } from "@/features/diff/unified-diff";
import { readFileSync } from "node:fs";
import { vi } from "vitest";

const appCss = readFileSync("src/styles/app.css", "utf8");
let appStyleElement: HTMLStyleElement;

beforeAll(() => {
  appStyleElement = document.createElement("style");
  appStyleElement.textContent = extractStyleRules([
    ".diff-review--full",
    ".diff-review--split",
    ".diff-review--unified",
    ".diff-review--full > .git-full-diff",
    ".git-full-diff__host .cm-mergeView",
  ]).join("\n");
  document.head.append(appStyleElement);
});

afterAll(() => {
  appStyleElement.remove();
});

vi.mock("@codemirror/merge", () => ({
  MergeView: class {
    constructor(config: { parent?: HTMLElement }) {
      const marker = document.createElement("div");
      marker.dataset.testid = "merge-view";
      marker.className = "cm-mergeView";
      config.parent?.append(marker);
    }
    destroy() {}
  },
}));

const demoDiffFiles = parseUnifiedDiff(`diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,2 @@
-old
+old
+new`);

describe("Git tool window", () => {
  it("shows diff inside the Git tool window after selecting a changed file", async () => {
    const user = userEvent.setup();

    render(
      <GitToolWindow
        files={demoDiffFiles}
        activeView="changes"
        tracePanel={<div>Trace</div>}
        onChangeView={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    const changedFile = screen.getByRole("button", { name: "src/main.ets M Modified" });
    await user.click(changedFile);

    expect(screen.getByRole("tab", { name: "Local Changes" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Line Trace" })).toBeVisible();
    expect(changedFile).toHaveClass("git-tool-window__file--active");
    expect(screen.getByLabelText("Git Diff Viewer")).toBeVisible();
    expect(screen.getByText("Modified", { selector: ".git-tool-window__viewer-status" })).toBeVisible();
    expect(screen.getByText("Open in Editor")).toHaveClass("git-tool-window__viewer-action");
    expect(screen.getByRole("button", { name: "Side-by-side" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Before")).toBeVisible();
    expect(screen.getByText("After")).toBeVisible();
    expect(screen.getByText("new")).toBeVisible();
    expect(window.getComputedStyle(screen.getByRole("toolbar", { name: "Diff viewer controls" }).parentElement!).overflow).toBe("auto");

    await user.click(screen.getByRole("button", { name: "Unified" }));
    expect(screen.getByText("+ new")).toBeVisible();
    expect(window.getComputedStyle(screen.getByRole("toolbar", { name: "Diff viewer controls" }).parentElement!).overflow).toBe("auto");
  });

  it("stages selected lines and exposes hunk actions for a working-tree diff", async () => {
    const user = userEvent.setup();
    const onApplyPartial = vi.fn().mockResolvedValue(undefined);
    render(
      <GitToolWindow
        files={demoDiffFiles}
        actionContext={{ relativePath: "src/main.ets", staged: false, kind: "modified" }}
        activeView="changes"
        tracePanel={<div>Trace</div>}
        onChangeView={vi.fn()}
        onOpenFile={vi.fn()}
        onApplyPartial={onApplyPartial}
      />,
    );

    expect(screen.getByRole("button", { name: "Stage Hunk" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Discard Hunk" })).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Select added line 2" }));
    expect(screen.getByText("1 selected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Stage Selected" }));

    expect(onApplyPartial).toHaveBeenCalledWith(
      "stage",
      "@@ -1,1 +1,2 @@\n old\n+new\n",
      { relativePath: "src/main.ets", staged: false, kind: "modified" },
    );
  });

  it("navigates diff hunks with F7 and Shift+F7", async () => {
    const files = parseUnifiedDiff(`diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,1 @@
-first
+changed first
@@ -10,1 +10,1 @@
-second
+changed second`);
    render(
      <GitToolWindow
        files={files}
        activeView="changes"
        tracePanel={<div>Trace</div>}
        onChangeView={vi.fn()}
        onOpenFile={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "src/main.ets M Modified" }));
    const viewer = screen.getByRole("toolbar", { name: "Diff viewer controls" }).parentElement!;
    expect(screen.getByText("1 / 2")).toBeVisible();
    fireEvent.keyDown(viewer, { key: "F7" });
    expect(screen.getByText("2 / 2")).toBeVisible();
    fireEvent.keyDown(viewer, { key: "F7", shiftKey: true });
    expect(screen.getByText("1 / 2")).toBeVisible();
  });

  it("uses a full-file merge view and keeps hunk review available", async () => {
    const user = userEvent.setup();
    render(
      <GitToolWindow
        files={demoDiffFiles}
        comparison={{
          relativePath: "src/main.ets",
          staged: false,
          before: { exists: true, binary: false, content: "old\n", truncated: false, totalBytes: 4 },
          after: { exists: true, binary: false, content: "old\nnew\n", truncated: false, totalBytes: 8 },
          patch: { content: "patch", truncated: false, totalBytes: 5 },
        }}
        actionContext={{ relativePath: "src/main.ets", staged: false, kind: "modified" }}
        activeView="changes"
        tracePanel={<div>Trace</div>}
        onChangeView={vi.fn()}
        onOpenFile={vi.fn()}
        onApplyPartial={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "src/main.ets M Modified" }));
    expect(screen.getByRole("button", { name: "Full File" })).toHaveAttribute("aria-pressed", "true");
    const comparison = await screen.findByRole("region", { name: "Full file comparison" });
    const review = screen.getByRole("toolbar", { name: "Diff viewer controls" }).parentElement!;
    expect(window.getComputedStyle(review).overflow).toBe("hidden");
    expect(window.getComputedStyle(review).height).toBe("100%");
    expect(window.getComputedStyle(comparison).gridRow).toBe("4");
    expect(window.getComputedStyle(screen.getByTestId("merge-view")).overflow).toBe("auto");
    expect(screen.getByText("Index")).toBeVisible();
    expect(screen.getByText("Working Tree")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Side-by-side" }));
    expect(screen.getByRole("button", { name: "Stage Hunk" })).toBeVisible();
  });
});

function extractStyleRules(targetSelectors: string[]) {
  return [...appCss.matchAll(/([^{}]+)\{([^{}]+)\}/g)]
    .filter((match) => {
      const selectors = match[1].split(",").map((selector) => selector.trim());
      return targetSelectors.some((targetSelector) => selectors.includes(targetSelector));
    })
    .map((match) => `${match[1]} {${match[2]}}`);
}
