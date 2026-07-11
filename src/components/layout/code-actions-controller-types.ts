import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  WorkspaceApi,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";

export type DocumentStoreRef = MutableRefObject<{
  getDocument(path: string): { currentContent: string; isDirty: boolean } | undefined;
  openDocument(path: string, content: string): void;
  applyExternalChange(path: string, content: string): void;
}>;

export type TabsStoreRef = MutableRefObject<{
  state: {
    openTabs: { path: string; title: string; isDirty: boolean }[];
    recentFiles: string[];
    activePath: string | null;
  };
}>;

export type UseCodeActionsWorkspaceEditControllerOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  editorSelection: { line: number; column: number };
  settingsApplying: boolean;
  getActiveContent: () => string;
  documentsRef: DocumentStoreRef;
  tabsRef: TabsStoreRef;
  setWorkspace: Dispatch<SetStateAction<WorkspaceViewModel | null>>;
  syncTabs: () => void;
  syncWorkspaceIndex: (workspace: WorkspaceViewModel) => void;
  setActiveDocument: (path: string | null) => void;
  clearCompletionSession: () => void;
  resetCompletionAnchor: () => void;
  closeOverlay: () => void;
  hideCurrentClassMethods: () => void;
  focusEditorSoon: () => void;
  onStatusChange: (message: string) => void;
};
