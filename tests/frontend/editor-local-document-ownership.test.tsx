import { Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { render, screen } from "@testing-library/react";
import { ArkTsEditor } from "@/editor/ArkTsEditor";
import { defaultSettings } from "@/features/settings/settings-store";

describe("editor local document ownership", () => {
  it("ignores stale local snapshots but applies external replacements", () => {
    const initial = Text.of(["base"]);
    const localDocuments: Text[] = [];
    const appearance = defaultSettings().editor;
    const onDocumentChange = (document: Text) => localDocuments.push(document);
    const { rerender } = render(
      <ArkTsEditor
        appearance={appearance}
        document={initial}
        onChange={() => undefined}
        onDocumentChange={onDocumentChange}
        path="C:/demo/Entry.ets"
      />,
    );
    const editor = screen.getByLabelText("Editor Content");
    const view = EditorView.findFromDOM(editor.closest(".cm-editor") as HTMLElement)!;

    view.dispatch({ changes: { from: 4, insert: "1" } });
    const staleLocalDocument = localDocuments.at(-1)!;
    view.dispatch({ changes: { from: 5, insert: "234567890" } });
    expect(view.state.doc.toString()).toBe("base1234567890");

    rerender(
      <ArkTsEditor
        appearance={appearance}
        document={staleLocalDocument}
        onChange={() => undefined}
        onDocumentChange={onDocumentChange}
        path="C:/demo/Entry.ets"
      />,
    );
    expect(view.state.doc.toString()).toBe("base1234567890");

    const external = Text.of(["external replacement"]);
    rerender(
      <ArkTsEditor
        appearance={appearance}
        document={external}
        onChange={() => undefined}
        onDocumentChange={onDocumentChange}
        path="C:/demo/Entry.ets"
      />,
    );
    expect(view.state.doc.toString()).toBe("external replacement");
  });
});
