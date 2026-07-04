import { useRef, useState } from "react";
import { createDocumentStore } from "@/features/documents/document-store";
import { createEditorTabsStore } from "@/features/documents/editor-tabs-store";

export function useEditorDocuments() {
  const documentsRef = useRef(createDocumentStore());
  const tabsRef = useRef(createEditorTabsStore(documentsRef.current));
  const [openTabs, setOpenTabs] = useState<{ path: string; title: string; isDirty: boolean }[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");

  function syncTabs() {
    setOpenTabs([...tabsRef.current.state.openTabs]);
  }

  function syncEditor(path: string | null) {
    setEditorContent(path ? documentsRef.current.getDocument(path)?.currentContent ?? "" : "");
  }

  function setActiveDocument(path: string | null) {
    setActivePath(path);
    syncEditor(path);
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
    editorContent,
    setEditorContent,
    syncTabs,
    syncEditor,
    setActiveDocument,
    resetTabs,
  };
}
