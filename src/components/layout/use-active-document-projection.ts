import { useEffect, useState, type MutableRefObject } from "react";
import {
  projectActiveDocument,
  sameActiveDocumentProjection,
  type ActiveDocumentProjection,
  type DocumentRuntimeStore,
} from "@/features/documents/document-runtime-store";

type UseActiveDocumentProjectionOptions = {
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  activePath: string | null;
  line: number;
  column: number;
  selectedText: string;
};

export function useActiveDocumentProjection(options: UseActiveDocumentProjectionOptions): ActiveDocumentProjection {
  const [projection, setProjection] = useState(() => projectActiveDocument(options));

  useEffect(() => {
    const updateProjection = () => {
      const next = projectActiveDocument(options);
      setProjection((current) => sameActiveDocumentProjection(current, next) ? current : next);
    };
    updateProjection();
    return options.documentsRef.current.subscribe((path) => {
      if (path === options.activePath) updateProjection();
    });
  }, [options.activePath, options.column, options.documentsRef, options.line, options.selectedText]);

  return projection;
}
