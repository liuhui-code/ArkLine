import { describe, expect, it } from "vitest";
import { createActiveDocumentRuntime } from "@/features/documents/active-document-runtime";
import { createDocumentStore } from "@/features/documents/document-store";

describe("active document runtime", () => {
  it("reads active document content length and slices through one boundary", () => {
    const documents = createDocumentStore();
    documents.openDocument("/workspace/A.ets", "0123456789");
    const runtime = createActiveDocumentRuntime({ current: documents }, () => "/workspace/A.ets");

    expect(runtime.getActiveContent()).toBe("0123456789");
    expect(runtime.getActiveContentLength()).toBe(10);
    expect(runtime.getActiveContentSlice(2, 6)).toBe("2345");
  });

  it("returns empty projections when no active document exists", () => {
    const documents = createDocumentStore();
    const runtime = createActiveDocumentRuntime({ current: documents }, () => null);

    expect(runtime.getActiveContent()).toBe("");
    expect(runtime.getActiveContentLength()).toBe(0);
    expect(runtime.getActiveContentSlice(0, 5)).toBe("");
  });
});
