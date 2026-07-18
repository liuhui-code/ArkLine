import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useRef } from "react";
import { useActiveDocumentProjection } from "@/components/layout/use-active-document-projection";
import { createDocumentStore } from "@/features/documents/document-store";

describe("useActiveDocumentProjection", () => {
  it("does not replace the projection for content-only updates after dirty state is stable", async () => {
    const { result } = renderHook(() => {
      const documentsRef = useRef(createDocumentStore());
      if (!documentsRef.current.getDocument("/workspace/A.ets")) {
        documentsRef.current.openDocument("/workspace/A.ets", "initial");
      }
      const projection = useActiveDocumentProjection({
        documentsRef,
        activePath: "/workspace/A.ets",
      });
      return { documentsRef, projection };
    });

    act(() => {
      result.current.documentsRef.current.updateDocument("/workspace/A.ets", "initial text");
    });
    await waitFor(() => expect(result.current.projection.isDirty).toBe(true));
    const dirtyProjection = result.current.projection;

    act(() => {
      result.current.documentsRef.current.updateDocument("/workspace/A.ets", "initial text!");
    });

    await waitFor(() => expect(result.current.projection).toBe(dirtyProjection));
  });
});
