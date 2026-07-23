import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { vi } from "vitest";
import { ShellSidebar } from "@/components/layout/ShellSidebar";
import { demoArkTsTree } from "@/components/layout/demo-arkts-project";
import type { WorkspaceViewModel } from "@/features/workspace/workspace-api";

describe("project tree render boundary", () => {
  it("keeps the tree mounted when unrelated sidebar props and callback identities change", () => {
    const firstOpen = vi.fn();
    const secondOpen = vi.fn();
    const workspace = createWorkspace();
    window.__arklineRenderPressure = { counts: {}, lastRenderedAt: {} };
    const { rerender } = renderSidebar(workspace, 280, firstOpen);

    rerender(createSidebar(workspace, 320, secondOpen));

    expect(window.__arklineRenderPressure.counts["Project/Tree"]).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Index.ets" }));
    expect(firstOpen).not.toHaveBeenCalled();
    expect(secondOpen).toHaveBeenCalledWith(
      demoArkTsTree.find((node) => node.name === "Index.ets")?.path,
    );
  });

  it("rerenders the tree when the active file changes", () => {
    const workspace = createWorkspace();
    window.__arklineRenderPressure = { counts: {}, lastRenderedAt: {} };
    const { rerender } = renderSidebar(workspace, 280, vi.fn());

    rerender(createSidebar(
      workspace,
      280,
      vi.fn(),
      "C:/samples/ArkDemo/entry/src/main/ets/pages/Index.ets",
    ));

    expect(window.__arklineRenderPressure.counts["Project/Tree"]).toBe(2);
    expect(screen.getByRole("button", { name: "Index.ets" })).toHaveAttribute("aria-current", "true");
  });
});

function renderSidebar(workspace: WorkspaceViewModel, width: number, onOpenFile: (path: string) => void) {
  return render(createSidebar(workspace, width, onOpenFile));
}

function createSidebar(
  workspace: WorkspaceViewModel,
  width: number,
  onOpenFile: (path: string) => void,
  activePath: string | null = null,
) {
  return (
    <ShellSidebar
      activePath={activePath}
      selectedProjectPath={null}
      activeTool="project"
      filesVisible
      width={width}
      minWidth={180}
      maxWidth={520}
      workspace={workspace}
      useLazyProjectTree={false}
      projectTreeChildren={{}}
      projectTreeLoadingPaths={new Set()}
      filesPaneRef={createRef<HTMLDivElement>()}
      onOpenFile={onOpenFile}
      onSelectProjectPath={vi.fn()}
      onLoadProjectDirectory={vi.fn()}
      onRequestProjectMutation={vi.fn()}
      onResizeWidth={vi.fn()}
      onSelectTool={vi.fn()}
    />
  );
}

function createWorkspace(): WorkspaceViewModel {
  return {
    rootName: "ArkDemo",
    rootPath: "C:/samples/ArkDemo",
    visibleFiles: demoArkTsTree.map((node) => node.path),
    fileTree: demoArkTsTree,
    scanSummary: {
      scannedFiles: demoArkTsTree.length,
      skippedEntries: 0,
      truncated: false,
      excludeRules: [],
    },
  };
}
