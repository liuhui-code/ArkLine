import { useRef, useState } from "react";
import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";

export function useEditorDocuments() {
  const documentsRef = useRef(createDocumentStore());
  const tabsRef = useRef(createEditorTabsStore(documentsRef.current));
  const [openTabs, setOpenTabs] = useState<{ path: string; title: string; isDirty: boolean }[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  function syncTabs() {
    setOpenTabs([...tabsRef.current.state.openTabs]);
  }

  function setActiveDocument(path: string | null) {
    setActivePath(path);
  }

  function resetTabs() {
    tabsRef.current.state.openTabs = [];
    tabsRef.current.state.activePath = null;
    setOpenTabs([]);
  }

  return {
    documentsRef,
    tabsRef,
    openTabs,
    activePath,
    setActivePath,
    syncTabs,
    setActiveDocument,
    resetTabs,
  };
}
