import { createDocumentStore } from "@/features/documents/document-store";

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
});
