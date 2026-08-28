import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GitEditorDiffPreview } from "@/components/layout/GitEditorDiffPreview";
import { GitToolWindow } from "@/components/layout/GitToolWindow";
import { parseUnifiedDiff } from "@/features/diff/unified-diff";

const files = parseUnifiedDiff(`diff --git a/src/main.ets b/src/main.ets
--- a/src/main.ets
+++ b/src/main.ets
@@ -1,1 +1,2 @@
-old
+old
+new`);

describe("Git workflow surfaces", () => {
  it("renders local changes in the central editor diff preview", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    render(<GitEditorDiffPreview files={files} comparison={null} actionContext={null} onApplyPartial={vi.fn()} onOpenFile={onOpenFile} onClose={vi.fn()} />);

    expect(screen.getByRole("region", { name: "Diff Preview" })).toBeVisible();
    expect(screen.getByRole("toolbar", { name: "Diff viewer controls" })).toBeVisible();
    expect(screen.getByText("new")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open File" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/main.ets");
  });

  it("opens a Git-quoted Unicode path as the workspace file", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const unicodeFiles = parseUnifiedDiff(`diff --git "a/\\344\\270\\255\\346\\226\\207 \\347\\273\\204\\344\\273\\266.ets" "b/\\344\\270\\255\\346\\226\\207 \\347\\273\\204\\344\\273\\266.ets"
--- "a/\\344\\270\\255\\346\\226\\207 \\347\\273\\204\\344\\273\\266.ets"
+++ "b/\\344\\270\\255\\346\\226\\207 \\347\\273\\204\\344\\273\\266.ets"
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;`);

    render(<GitEditorDiffPreview files={unicodeFiles} comparison={null} actionContext={null} onApplyPartial={vi.fn()} onOpenFile={onOpenFile} onClose={vi.fn()} />);

    expect(screen.getAllByText("中文 组件.ets")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Open File" }));
    expect(onOpenFile).toHaveBeenCalledWith("中文 组件.ets");
  });

  it("keeps partial hunk actions available in the preview", async () => {
    const user = userEvent.setup();
    const onApplyPartial = vi.fn().mockResolvedValue(undefined);
    render(<GitEditorDiffPreview files={files} comparison={null} actionContext={{ relativePath: "src/main.ets", staged: false, kind: "modified" }} onApplyPartial={onApplyPartial} onOpenFile={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "Stage Hunk" }));
    expect(onApplyPartial).toHaveBeenCalledWith("stage", expect.stringContaining("+new"), expect.objectContaining({ relativePath: "src/main.ets" }));
  });

  it("uses the bottom Git tool window for Log, Stashes, and Line Trace", async () => {
    const user = userEvent.setup();
    const onChangeView = vi.fn();
    render(<GitToolWindow activeView="trace" history={{} as never} stash={{} as never} branches={null} tracePanel={<div>Trace content</div>} onRefreshBranches={vi.fn()} onChangeView={onChangeView} />);

    expect(screen.getByRole("tab", { name: "Log" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "Stashes" })).toBeVisible();
    expect(screen.getByText("Trace content")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Log" }));
    expect(onChangeView).toHaveBeenCalledWith("log");
  });
});
