import {
  createEditorDocumentSessionRegistry,
  DEFAULT_HOT_EDITOR_SESSION_CAPACITY,
} from "@/editor/editor-document-session-registry";

describe("editor document session registry", () => {
  it("keeps recently used editor metadata within a bounded capacity", () => {
    const registry = createEditorDocumentSessionRegistry(2);
    const session = (position: number) => ({
      selectionAnchor: position,
      selectionHead: position,
      scrollTop: 0,
      scrollLeft: 0,
      enhanced: true,
    });

    registry.save("A", session(1));
    registry.save("B", session(2));
    expect(registry.restore("A")?.selectionHead).toBe(1);
    registry.save("C", session(3));

    expect(registry.restore("B")).toBeUndefined();
    expect(registry.restore("A")?.selectionHead).toBe(1);
    expect(registry.restore("C")?.selectionHead).toBe(3);
    expect(registry.size()).toBe(2);
  });

  it("does not retain inactive document text or full editor states", () => {
    const registry = createEditorDocumentSessionRegistry();
    for (let index = 0; index <= DEFAULT_HOT_EDITOR_SESSION_CAPACITY; index += 1) {
      registry.save(String(index), {
        selectionAnchor: index,
        selectionHead: index,
        scrollTop: index,
        scrollLeft: 0,
        enhanced: true,
      });
    }

    expect(registry.size()).toBe(DEFAULT_HOT_EDITOR_SESSION_CAPACITY);
    expect(registry.restore("0")).toBeUndefined();
    expect(registry.retainedDocumentCharacters()).toBe(0);
  });
});
