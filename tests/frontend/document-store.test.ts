import { createDocumentStore } from "@/features/documents/document-store";
import { vi } from "vitest";

describe("document store safety", () => {
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
});
