export type ActiveDocumentRuntime = {
  getActiveContent: () => string;
  getActiveContentLength: () => number;
  getActiveContentSlice: (start: number, end: number) => string;
};

type DocumentLookupRef = {
  current: {
    getDocument(path: string): { currentContent: string } | undefined;
    getDocumentLength?(path: string): number | undefined;
    getDocumentSlice?(path: string, start: number, end: number): string | undefined;
  };
};

export function createActiveDocumentRuntime(
  documentsRef: DocumentLookupRef,
  getActivePath: () => string | null,
): ActiveDocumentRuntime {
  function getCurrentContent() {
    const activePath = getActivePath();
    return activePath ? documentsRef.current.getDocument(activePath)?.currentContent ?? "" : "";
  }

  function getCurrentPath() {
    return getActivePath();
  }

  return {
    getActiveContent: getCurrentContent,
    getActiveContentLength: () => {
      const path = getCurrentPath();
      return path ? documentsRef.current.getDocumentLength?.(path) ?? getCurrentContent().length : 0;
    },
    getActiveContentSlice: (start, end) => {
      const path = getCurrentPath();
      return path ? documentsRef.current.getDocumentSlice?.(path, start, end) ?? getCurrentContent().slice(start, end) : "";
    },
  };
}
