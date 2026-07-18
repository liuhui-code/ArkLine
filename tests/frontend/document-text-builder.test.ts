import { describe, expect, it, vi } from "vitest";
import { buildDocumentText } from "@/features/documents/document-text-builder";

describe("document text builder", () => {
  it("preserves content and line boundaries across arbitrary chunks", async () => {
    const content = "first line\nsecond line\nthird line\n";
    const document = await buildDocumentText(content, {
      chunkSize: 7,
      yieldTask: async () => undefined,
    });

    expect(document.toString()).toBe(content);
    expect(document.lines).toBe(4);
  });

  it("yields between large document chunks", async () => {
    const yieldTask = vi.fn(async () => undefined);
    const document = await buildDocumentText("abcdefghij", {
      chunkSize: 3,
      yieldTask,
    });

    expect(document.toString()).toBe("abcdefghij");
    expect(yieldTask).toHaveBeenCalledTimes(3);
  });

  it("keeps small document construction on the synchronous fast path", async () => {
    const yieldTask = vi.fn(async () => undefined);
    const document = await buildDocumentText("small", {
      chunkSize: 10,
      yieldTask,
    });

    expect(document.toString()).toBe("small");
    expect(yieldTask).not.toHaveBeenCalled();
  });
});
