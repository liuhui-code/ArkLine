import type { MutableRefObject } from "react";
import type { DocumentRecord, createDocumentStore } from "@/features/documents/document-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

export type DocumentRuntimeStore = ReturnType<typeof createDocumentStore>;

export type ActiveDocumentProjection = {
  activePath: string | null;
  title: string;
  isDirty: boolean;
};

export type ActiveDocumentProjectionInput = {
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  activePath: string | null;
};

export function projectActiveDocument(input: ActiveDocumentProjectionInput): ActiveDocumentProjection {
  const document = input.activePath ? input.documentsRef.current.getDocument(input.activePath) : undefined;
  return {
    activePath: input.activePath,
    title: input.activePath ? getPathBasename(input.activePath) : "",
    isDirty: document?.isDirty ?? false,
  };
}

export function sameActiveDocumentProjection(left: ActiveDocumentProjection, right: ActiveDocumentProjection) {
  return left.activePath === right.activePath
    && left.title === right.title
    && left.isDirty === right.isDirty;
}

export function isActiveDocumentRecord(path: string, activePath: string | null, document: DocumentRecord) {
  return activePath === path && document.path === path;
}
