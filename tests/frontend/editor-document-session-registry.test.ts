import { EditorState } from "@codemirror/state";
import { createEditorDocumentSessionRegistry } from "@/editor/editor-document-session-registry";

describe("editor document session registry", () => {
  it("keeps recently used sessions within a bounded capacity", () => {
    const registry = createEditorDocumentSessionRegistry(2);
    const session = (content: string) => ({
      state: EditorState.create({ doc: content }),
      scrollTop: 0,
      scrollLeft: 0,
      enhanced: true,
    });

    registry.save("A", session("A"));
    registry.save("B", session("B"));
    expect(registry.restore("A")?.state.doc.toString()).toBe("A");
    registry.save("C", session("C"));

    expect(registry.restore("B")).toBeUndefined();
    expect(registry.restore("A")?.state.doc.toString()).toBe("A");
    expect(registry.restore("C")?.state.doc.toString()).toBe("C");
    expect(registry.size()).toBe(2);
  });
});
