export type ActiveDocumentRuntime = {
  getActiveContent: () => string;
  getActiveContentLength: () => number;
  getActiveContentSlice: (start: number, end: number) => string;
};

type DocumentLookupRef = {
  current: {
    getDocument(path: string): { currentContent: string } | undefined;
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

  return {
    getActiveContent: getCurrentContent,
    getActiveContentLength: () => getCurrentContent().length,
    getActiveContentSlice: (start, end) => getCurrentContent().slice(start, end),
  };
}
