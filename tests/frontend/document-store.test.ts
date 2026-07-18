import { createDocumentStore } from "@/features/documents/document-store";
import { Text } from "@codemirror/state";
import { vi } from "vitest";

describe("document store safety", () => {
  it("opens a prebuilt editor document without reconstructing its text", () => {
    const store = createDocumentStore();
    const document = Text.of(["first", "second"]);

    store.openDocumentText("C:/work/main.ets", "first\nsecond", document);

    expect(store.getDocumentText("C:/work/main.ets")).toBe(document);
    expect(store.getDocument("C:/work/main.ets")?.currentContent).toBe("first\nsecond");
  });

  it("keeps a dirty buffer when the file changes externally", () => {
    const store = createDocumentStore();
    store.openDocument("C:/work/main.ets", "original");
    store.updateDocument("C:/work/main.ets", "local edit");

    const result = store.applyExternalChange("C:/work/main.ets", "disk edit");

    expect(result).toBe("conflict");
    expect(store.getDocument("C:/work/main.ets")?.currentContent).toBe("local edit");
    expect(store.getDocument("C:/work/main.ets")?.externalContent).toBe("disk edit");
  });

  it("refreshes a clean buffer after an external change", () => {
    const store = createDocumentStore();
    store.openDocument("C:/work/main.ets", "original");

    expect(store.applyExternalChange("C:/work/main.ets", "disk edit")).toBe("updated");
    expect(store.getDocument("C:/work/main.ets")?.currentContent).toBe("disk edit");
  });

  it("coalesces repeated notifications for the same path", async () => {
    const store = createDocumentStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.openDocument("C:/work/main.ets", "original");
    store.updateDocument("C:/work/main.ets", "edit 1");
    store.updateDocument("C:/work/main.ets", "edit 2");

    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0]).toBe(listener.mock.calls[0]?.[1].path);
    expect(listener.mock.calls[0]?.[1]).toEqual(expect.objectContaining({ currentContent: "edit 2" }));
  });

  it("keeps separate notifications for different paths", async () => {
    const store = createDocumentStore();
    const listener = vi.fn();
    store.subscribe(listener);

    store.openDocument("C:/work/A.ets", "A");
    store.openDocument("C:/work/B.ets", "B");

    await Promise.resolve();
    expect(listener.mock.calls.map((call) => call[1].path)).toEqual(listener.mock.calls.map((call) => call[0]));
    expect(listener.mock.calls.map((call) => call[1].currentContent)).toEqual(["A", "B"]);
  });

  it("tracks whether any document is dirty without scanning callers", () => {
    const store = createDocumentStore();

    store.openDocument("C:/work/A.ets", "A");
    store.openDocument("C:/work/B.ets", "B");
    expect(store.hasDirtyDocuments()).toBe(false);

    store.updateDocument("C:/work/A.ets", "A changed");
    expect(store.hasDirtyDocuments()).toBe(true);

    store.saveDocument("C:/work/A.ets");
    expect(store.hasDirtyDocuments()).toBe(false);
  });

  it("keeps dirty state correct across external updates and reopening", () => {
    const store = createDocumentStore();

    store.openDocument("C:/work/A.ets", "A");
    store.updateDocument("C:/work/A.ets", "A changed");
    expect(store.applyExternalChange("C:/work/A.ets", "disk A")).toBe("conflict");
    expect(store.hasDirtyDocuments()).toBe(true);

    store.openDocument("C:/work/A.ets", "fresh A");
    expect(store.hasDirtyDocuments()).toBe(false);

    expect(store.applyExternalChange("C:/work/A.ets", "disk A 2")).toBe("updated");
    expect(store.hasDirtyDocuments()).toBe(false);
  });

  it("applies persistent editor text without publishing a content replacement", async () => {
    const store = createDocumentStore();
    const listener = vi.fn();
    store.openDocument("C:/work/A.ets", "A");
    await Promise.resolve();
    const normalizedPath = store.getDocument("C:/work/A.ets")!.path;
    store.subscribe(listener);

    const result = store.applyEditorDocument("C:/work/A.ets", Text.of(["A changed"]));

    expect(result).toEqual({ dirtyChanged: true });
    expect(store.getDocument("C:/work/A.ets")?.currentContent).toBe("A changed");
    await Promise.resolve();
    expect(listener).toHaveBeenCalledWith(
      normalizedPath,
      expect.objectContaining({ isDirty: true }),
      "metadata",
    );
  });

  it("does not notify React subscribers for each editor transaction after becoming dirty", async () => {
    const store = createDocumentStore();
    const listener = vi.fn();
    store.openDocument("C:/work/A.ets", "A");
    await Promise.resolve();
    store.subscribe(listener);

    store.applyEditorDocument("C:/work/A.ets", Text.of(["AB"]));
    await Promise.resolve();
    listener.mockClear();
    store.applyEditorDocument("C:/work/A.ets", Text.of(["ABC"]));
    store.applyEditorDocument("C:/work/A.ets", Text.of(["ABCD"]));
    await Promise.resolve();

    expect(listener).not.toHaveBeenCalled();
    expect(store.getDocument("C:/work/A.ets")?.currentContent).toBe("ABCD");
  });

  it("publishes metadata when undo returns the editor document to its saved state", async () => {
    const store = createDocumentStore();
    const listener = vi.fn();
    store.openDocument("C:/work/A.ets", "A");
    await Promise.resolve();
    const normalizedPath = store.getDocument("C:/work/A.ets")!.path;
    store.subscribe(listener);
    store.applyEditorDocument("C:/work/A.ets", Text.of(["AB"]));
    await Promise.resolve();
    listener.mockClear();

    const result = store.applyEditorDocument("C:/work/A.ets", Text.of(["A"]));
    await Promise.resolve();

    expect(result).toEqual({ dirtyChanged: true });
    expect(store.hasDirtyDocuments()).toBe(false);
    expect(listener).toHaveBeenCalledWith(
      normalizedPath,
      expect.objectContaining({ isDirty: false }),
      "metadata",
    );
  });
});
