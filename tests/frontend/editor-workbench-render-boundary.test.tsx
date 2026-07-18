import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeEach, vi } from "vitest";
import {
  AppShellEditorWorkbench,
  type AppShellEditorWorkbenchProps,
} from "@/components/layout/AppShellEditorWorkbench";
import { createDocumentStore } from "@/features/documents/document-store";
import { defaultSettings } from "@/features/settings/settings-store";
import { idleUsageSearchState } from "@/features/workspace/usage-search";

const editorSurfaceRender = vi.hoisted(() => vi.fn());

vi.mock("@/components/layout/EditorSurface", () => ({
  EditorSurface: (props: { activePath: string | null; onSelectTab: (path: string) => void }) => {
    editorSurfaceRender();
    return (
      <button type="button" onClick={() => props.onSelectTab("/workspace/Entry.ets")}>
        Mock Editor Surface {props.activePath ?? "empty"}
      </button>
    );
  },
}));

describe("editor workbench render boundary", () => {
  beforeEach(() => {
    editorSurfaceRender.mockClear();
  });

  it("does not rerender EditorSurface when only callback identities change", () => {
    const firstSelect = vi.fn();
    const secondSelect = vi.fn();
    const initialProps = createProps(firstSelect);
    const { rerender } = render(
      <AppShellEditorWorkbench {...initialProps} />,
    );

    rerender(<AppShellEditorWorkbench {...initialProps} onSelectTab={secondSelect} />);

    expect(editorSurfaceRender).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mock Editor Surface empty" }));
    expect(firstSelect).not.toHaveBeenCalled();
    expect(secondSelect).toHaveBeenCalledWith("/workspace/Entry.ets");
  });

  it("rerenders EditorSurface when editor data changes", () => {
    const initialProps = createProps(vi.fn());
    const { rerender } = render(<AppShellEditorWorkbench {...initialProps} />);

    rerender(
      <AppShellEditorWorkbench
        {...initialProps}
        activePath="/workspace/Entry.ets"
        openTabs={[{ path: "/workspace/Entry.ets", title: "Entry.ets", isDirty: false }]}
      />,
    );

    expect(editorSurfaceRender).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("button", { name: "Mock Editor Surface /workspace/Entry.ets" })).toBeInTheDocument();
  });
});

function createProps(onSelectTab: (path: string) => void): AppShellEditorWorkbenchProps {
  return {
    queryPanelVisible: false,
    usageSearch: idleUsageSearchState(),
    onCloseEditorQueryPanel: vi.fn(),
    onOpenUsage: vi.fn(),
    activePath: null,
    documentsRef: { current: createDocumentStore() },
    openTabs: [],
    appearance: defaultSettings().editor,
    focusToken: 0,
    insertTextTarget: null,
    selectionTarget: null,
    workspaceName: null,
    surfaceRef: createRef<HTMLElement>(),
    onChange: vi.fn(),
    onSelectionChange: vi.fn(),
    onCaretRectChange: vi.fn(),
    onDefinitionTrigger: vi.fn(),
    onTypingCompletionTrigger: vi.fn(),
    blameAttributions: [],
    gitBlameVisible: false,
    selectedBlameLine: null,
    onGitTraceLineClick: vi.fn(),
    onSelectTab,
    onCloseTab: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onCloseTabsToRight: vi.fn(),
    onCopyTabPath: vi.fn(),
    onEditorGoToDefinition: vi.fn(),
    onEditorFindUsages: vi.fn(),
    onEditorFormatDocument: vi.fn(),
    onEditorCopyPath: vi.fn(),
    onToggleGitBlame: vi.fn(),
  };
}
