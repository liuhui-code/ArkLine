import { EditorState, Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useEditorSurfaceController } from "@/components/layout/use-editor-surface-controller";
import { createCodeMirrorSignatureHelpExtension } from "@/editor/codemirror-signature-help";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

describe("editor input hot path", () => {
  it("keeps CodeMirror Text snapshots out of string materialization and semantic IPC while typing", () => {
    const document = Text.of(["const value = 1;"]);
    const applyEditorDocument = vi.fn(() => ({ dirtyChanged: false }));
    const toString = vi.spyOn(Text.prototype, "toString");
    const { result } = renderHook(() => useEditorSurfaceController({
      workspaceApi: { openFile: vi.fn(async () => "") } as unknown as WorkspaceApi,
      activePath: "/workspace/Main.ets",
      quickOpenQuery: "",
      documentsRef: {
        current: {
          getDocument: () => ({ currentContent: "const value = 1;" }),
          openDocument: vi.fn(),
          updateDocument: vi.fn(() => ({ dirtyChanged: false })),
          applyEditorDocument,
        },
      },
      tabsRef: { current: { openTab: vi.fn() } },
      syncTabs: vi.fn(),
      setActiveDocument: vi.fn(),
      includeVisibleWorkspaceFile: vi.fn(),
      closeCompletion: vi.fn(),
      resetCodeActionSession: vi.fn(),
      setEditorSelection: vi.fn(),
      setInsertTextTarget: vi.fn(),
      setSelectionTarget: vi.fn(),
      setActiveOverlay: vi.fn(),
      setQuickOpenQuery: vi.fn(),
      bumpEditorFocusToken: vi.fn(),
      rememberCurrentLocation: vi.fn(),
      focusEditorSoon: vi.fn(),
      onStatusChange: vi.fn(),
    }));

    act(() => result.current.handleEditorDocumentChange(document));

    expect(applyEditorDocument).toHaveBeenCalledWith("/workspace/Main.ets", document);
    expect(toString).not.toHaveBeenCalled();
    toString.mockRestore();
  });

  it("reads signature context from a bounded document slice", () => {
    const prefix = "const padding = 1;\n".repeat(8_000);
    const host = document.createElement("div");
    document.body.append(host);
    const toString = vi.spyOn(Text.prototype, "toString");
    const view = new EditorView({
      state: EditorState.create({
        doc: `${prefix}call(`,
        extensions: [createCodeMirrorSignatureHelpExtension(
          () => "/workspace/Main.ets",
          async () => null,
        )],
      }),
      parent: host,
    });

    view.dispatch({ changes: { from: view.state.doc.length, insert: "a" } });

    expect(toString).not.toHaveBeenCalled();
    view.destroy();
    host.remove();
    toString.mockRestore();
  });
});
