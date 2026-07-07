import { useCallback, useSyncExternalStore, type MutableRefObject } from "react";
import type { DocumentRuntimeStore } from "@/features/documents/document-runtime-store";
import { normalizePath } from "@/features/workspace/workspace-store";

type UseActiveDocumentContentOptions = {
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  activePath: string | null;
  fallback?: string;
};

export function useActiveDocumentContent({
  documentsRef,
  activePath,
  fallback = "",
}: UseActiveDocumentContentOptions) {
  const normalizedPath = activePath ? normalizePath(activePath) : null;
  const getSnapshot = useCallback(() => {
    if (!normalizedPath) return "";
    return documentsRef.current.getDocument(normalizedPath)?.currentContent ?? fallback;
  }, [documentsRef, fallback, normalizedPath]);
  const subscribe = useCallback((listener: () => void) => {
    if (!normalizedPath) return () => undefined;
    return documentsRef.current.subscribe((path) => {
      if (path === normalizedPath) listener();
    });
  }, [documentsRef, normalizedPath]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
