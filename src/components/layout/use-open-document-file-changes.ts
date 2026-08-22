import { useEffect, type MutableRefObject } from "react";
import { reconcileOpenDocumentFileChange } from "@/features/documents/open-document-file-changes";
import type { DocumentRuntimeStore } from "@/features/documents/document-runtime-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type UseOpenDocumentFileChangesOptions = {
  rootPath: string | null;
  documentsRef: MutableRefObject<DocumentRuntimeStore>;
  workspaceApi: WorkspaceApi;
  onStatusChange: (message: string) => void;
};

export function useOpenDocumentFileChanges({
  rootPath,
  documentsRef,
  workspaceApi,
  onStatusChange,
}: UseOpenDocumentFileChangesOptions) {
  useEffect(() => {
    if (!rootPath || !workspaceApi.watchWorkspaceFileChanges) return;

    let disposed = false;
    let teardown: (() => void) | null = null;

    void workspaceApi.watchWorkspaceFileChanges(rootPath, (event) => {
      void reconcileOpenDocumentFileChange({
        event,
        documents: documentsRef.current,
        openFile: workspaceApi.openFile,
      }).catch((error) => {
        if (!disposed) {
          onStatusChange(`File change reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }).then((nextTeardown) => {
      if (disposed) nextTeardown();
      else teardown = nextTeardown;
    }).catch((error) => {
      if (!disposed) {
        onStatusChange(`File change watcher failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    return () => {
      disposed = true;
      teardown?.();
    };
  }, [documentsRef, onStatusChange, rootPath, workspaceApi]);
}
