import type { MutableRefObject } from "react";
import type { DocumentRecord, createDocumentStore } from "@/features/documents/document-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

export type DocumentRuntimeStore = ReturnType<typeof createDocumentStore>;

export type ActiveDocumentProjection = {
  activePath: string | null;
  title: string;
  isDirty: boolean;
  line: number;
  column: number;
  selectedText: string;
};

export type ActiveDocumentProjectionInput = {
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  activePath: string | null;
  line: number;
  column: number;
  selectedText: string;
};

export function projectActiveDocument(input: ActiveDocumentProjectionInput): ActiveDocumentProjection {
  const document = input.activePath ? input.documentsRef.current.getDocument(input.activePath) : undefined;
  return {
    activePath: input.activePath,
    title: input.activePath ? getPathBasename(input.activePath) : "",
    isDirty: document?.isDirty ?? false,
    line: input.line,
    column: input.column,
    selectedText: input.selectedText,
  };
}

export function sameActiveDocumentProjection(left: ActiveDocumentProjection, right: ActiveDocumentProjection) {
  return left.activePath === right.activePath
    && left.title === right.title
    && left.isDirty === right.isDirty
    && left.line === right.line
    && left.column === right.column
    && left.selectedText === right.selectedText;
}

export function isActiveDocumentRecord(path: string, activePath: string | null, document: DocumentRecord) {
  return activePath === path && document.path === path;
}
