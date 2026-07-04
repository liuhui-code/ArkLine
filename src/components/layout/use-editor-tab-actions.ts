import type { MutableRefObject } from "react";
import type { createEditorTabsStore } from "@/features/documents/editor-tabs-store";
import { getPathBasename } from "@/features/workspace/workspace-store";

type EditorTabsStore = ReturnType<typeof createEditorTabsStore>;

export type UseEditorTabActionsOptions = {
  tabsRef: MutableRefObject<EditorTabsStore>;
  activePath: string | null;
  syncTabs: () => void;
  setActiveDocument: (path: string | null) => void;
  resetTransientEditorTargets: () => void;
  onStatusChange: (message: string) => void;
  onFocusEditorSoon: () => void;
};

export function useEditorTabActions({
  tabsRef,
  activePath,
  syncTabs,
  setActiveDocument,
  resetTransientEditorTargets,
  onStatusChange,
  onFocusEditorSoon,
}: UseEditorTabActionsOptions) {
  function closeActiveFile() {
    if (!tabsRef.current.state.activePath) {
      return;
    }
    tabsRef.current.closeTab(tabsRef.current.state.activePath);
    syncTabs();
    setActiveDocument(tabsRef.current.state.activePath);
    resetTransientEditorTargets();
    onStatusChange(tabsRef.current.state.activePath ? `Closed ${getPathBasename(activePath ?? "")}` : "Closed file");
    onFocusEditorSoon();
  }

  function closeEditorTab(path: string) {
    tabsRef.current.closeTab(path);
    syncTabs();
    setActiveDocument(tabsRef.current.state.activePath);
    onStatusChange(tabsRef.current.state.activePath ? `Closed ${getPathBasename(path)}` : "Closed file");
    onFocusEditorSoon();
  }

  function closeOtherEditorTabs(path: string) {
    tabsRef.current.closeOtherTabs(path);
    syncTabs();
    setActiveDocument(tabsRef.current.state.activePath);
    onStatusChange(`Closed other tabs for ${getPathBasename(path)}`);
    onFocusEditorSoon();
  }

  function closeEditorTabsToRight(path: string) {
    tabsRef.current.closeTabsToRight(path);
    syncTabs();
    setActiveDocument(tabsRef.current.state.activePath);
    onStatusChange(`Closed tabs to the right of ${getPathBasename(path)}`);
    onFocusEditorSoon();
  }

  function copyEditorTabPath(path: string) {
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(path);
    onStatusChange(`Copied path ${getPathBasename(path)}`);
  }

  function copyActiveEditorPath() {
    if (!activePath || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    void navigator.clipboard.writeText(activePath);
    onStatusChange(`Copied path ${getPathBasename(activePath)}`);
  }

  return {
    closeActiveFile,
    closeEditorTab,
    closeOtherEditorTabs,
    closeEditorTabsToRight,
    copyEditorTabPath,
    copyActiveEditorPath,
  };
}
