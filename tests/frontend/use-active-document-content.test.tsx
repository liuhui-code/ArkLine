import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import {
  useActiveDocumentContent,
  useActiveDocumentText,
} from "@/components/layout/use-active-document-content";
import { createDocumentStore } from "@/features/documents/document-store";
import { Text } from "@codemirror/state";

describe("useActiveDocumentContent", () => {
  it("subscribes to the active document content only", async () => {
    const { result } = renderHook(() => {
      const documentsRef = useRef(createDocumentStore());
      if (!documentsRef.current.getDocument("/workspace/A.ets")) {
        documentsRef.current.openDocument("/workspace/A.ets", "A");
        documentsRef.current.openDocument("/workspace/B.ets", "B");
      }
      const content = useActiveDocumentContent({
        documentsRef,
        activePath: "/workspace/A.ets",
      });
      return { documentsRef, content };
    });

    act(() => {
      result.current.documentsRef.current.updateDocument("/workspace/B.ets", "B changed");
    });
    expect(result.current.content).toBe("A");

    act(() => {
      result.current.documentsRef.current.updateDocument("/workspace/A.ets", "A changed");
    });
    await waitFor(() => expect(result.current.content).toBe("A changed"));
  });

  it("does not replace the controlled editor value for local editor transactions", async () => {
    const { result } = renderHook(() => {
      const documentsRef = useRef(createDocumentStore());
      if (!documentsRef.current.getDocument("/workspace/A.ets")) {
        documentsRef.current.openDocument("/workspace/A.ets", "initial");
      }
      return {
        documentsRef,
        content: useActiveDocumentContent({ documentsRef, activePath: "/workspace/A.ets" }),
      };
    });

    await act(async () => Promise.resolve());
    act(() => {
      result.current.documentsRef.current.applyEditorDocument(
        "/workspace/A.ets",
        Text.of(["local edit"]),
      );
    });
    await act(async () => Promise.resolve());

    expect(result.current.content).toBe("initial");
    expect(result.current.documentsRef.current.getDocument("/workspace/A.ets")?.currentContent).toBe("local edit");

    act(() => {
      result.current.documentsRef.current.updateDocument("/workspace/A.ets", "external replacement");
    });
    await waitFor(() => expect(result.current.content).toBe("external replacement"));
  });

  it("exposes the immutable editor document without materializing a string snapshot", async () => {
    const { result } = renderHook(() => {
      const documentsRef = useRef(createDocumentStore());
      if (!documentsRef.current.getDocument("/workspace/A.ets")) {
        documentsRef.current.openDocument("/workspace/A.ets", "initial");
      }
      return {
        documentsRef,
        document: useActiveDocumentText({ documentsRef, activePath: "/workspace/A.ets" }),
      };
    });
    const initialDocument = result.current.document;

    act(() => {
      result.current.documentsRef.current.applyEditorDocument(
        "/workspace/A.ets",
        initialDocument.replace(0, initialDocument.length, Text.of(["local edit"])),
      );
    });
    await act(async () => Promise.resolve());

    expect(result.current.document).not.toBe(initialDocument);
    expect(result.current.document).toBe(
      result.current.documentsRef.current.getDocumentText("/workspace/A.ets"),
    );
    expect(result.current.document.toString()).toBe("local edit");

    act(() => {
      result.current.documentsRef.current.updateDocument("/workspace/A.ets", "external replacement");
    });
    await waitFor(() => expect(result.current.document.toString()).toBe("external replacement"));
  });
});
