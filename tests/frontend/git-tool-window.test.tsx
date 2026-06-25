import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitToolWindow } from "@/components/layout/GitToolWindow";
import { parseUnifiedDiff } from "@/features/diff/unified-diff";
import { vi } from "vitest";

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
    expect(screen.getByText("+ new")).toBeVisible();
  });
});
