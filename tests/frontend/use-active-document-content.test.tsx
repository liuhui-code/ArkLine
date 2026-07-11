import { act, renderHook, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it } from "vitest";
import { useActiveDocumentContent } from "@/components/layout/use-active-document-content";
import { createDocumentStore } from "@/features/documents/document-store";

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
});
