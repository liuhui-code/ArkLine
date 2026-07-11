import { useRef, useState } from "react";
import {
  pathWithinDirectory,
  replaceDirectoryPrefix,
  uniqueNormalizedPaths,
} from "@/components/layout/app-shell-model";
import {
  buildCodeActionsEditorRequest,
  codeActionsSourceStatus,
  emptyCodeActionsMessage,
  filterCodeActionsForSource,
  type CodeActionsSource,
} from "@/components/layout/code-actions-request-model";
import {
  isWorkspaceEditPlan,
  type CodeActionsStatus,
  type ProjectMutationDialogState,
} from "@/components/layout/app-shell-types";
import type { UseCodeActionsWorkspaceEditControllerOptions } from "@/components/layout/code-actions-controller-types";
import { requiresPreview, type CodeAction, type WorkspaceEditPlan } from "@/features/code-actions/code-action-model";
import { createFileTreeNodes } from "@/features/workspace/file-tree-store";
import { createNewDirectoryPlan, createNewFilePlan } from "@/features/workspace/workspace-mutation-plans";
import type {
  WorkspaceEditPreview as WorkspaceEditPreviewModel,
} from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export function useCodeActionsWorkspaceEditController({
  workspace,
  workspaceApi,
  activePath,
  editorSelection,
  settingsApplying,
  getActiveContent,
  documentsRef,
  tabsRef,
  setWorkspace,
  syncTabs,
  syncWorkspaceIndex,
  setActiveDocument,
  clearCompletionSession,
  resetCompletionAnchor,
  closeOverlay,
  hideCurrentClassMethods,
  focusEditorSoon,
  onStatusChange,
}: UseCodeActionsWorkspaceEditControllerOptions) {
  const codeActionsRequestRef = useRef(0);
  const codeActionResolveRequestRef = useRef(0);
  const [codeActionsVisible, setCodeActionsVisible] = useState(false);
  const [codeActions, setCodeActions] = useState<CodeAction[]>([]);
  const [codeActionsStatus, setCodeActionsStatus] = useState<CodeActionsStatus>("empty");
  const [codeActionsMessage, setCodeActionsMessage] = useState<string | undefined>();
  const [codeActionsSelectedIndex, setCodeActionsSelectedIndex] = useState(0);
  const [workspaceEditPreview, setWorkspaceEditPreview] = useState<WorkspaceEditPreviewModel | null>(null);
  const [workspaceEditApplyState, setWorkspaceEditApplyState] = useState<"idle" | "applying" | "error">("idle");
  const [workspaceEditMessage, setWorkspaceEditMessage] = useState<string | undefined>();
  const [projectMutationDialog, setProjectMutationDialog] = useState<ProjectMutationDialogState | null>(null);

  function resetWorkspaceEdit() {
    setWorkspaceEditPreview(null);
    setWorkspaceEditApplyState("idle");
    setWorkspaceEditMessage(undefined);
  }

  function resetCodeActions() {
    setCodeActionsVisible(false);
    codeActionResolveRequestRef.current += 1;
  }

  function resetCodeActionSession() {
    codeActionResolveRequestRef.current += 1;
    setCodeActionsVisible(false);
    resetWorkspaceEdit();
  }

  function closeCodeActionsPalette() {
    codeActionResolveRequestRef.current += 1;
    setCodeActionsVisible(false);
    focusEditorSoon();
  }

  function closeWorkspaceEditPreview() {
    if (workspaceEditApplyState === "applying") {
      return;
    }

    resetWorkspaceEdit();
    focusEditorSoon();
  }

  async function refreshAppliedWorkspaceEditFiles(changedFiles: string[], plan: WorkspaceEditPlan) {
    const renamedOldPaths = new Set(plan.operations
      .filter((operation) => operation.kind === "renameFile")
      .map((operation) => normalizePath(operation.oldPath)));

    for (const path of [...new Set(changedFiles)]) {
      if (renamedOldPaths.has(normalizePath(path))) {
        continue;
      }

      const document = documentsRef.current.getDocument(path);
      if (!document) {
        continue;
      }

      const content = await workspaceApi.openFile(path);
      documentsRef.current.applyExternalChange(path, content);
    }
  }

  function updateWorkspaceFilesForAppliedEdit(plan: WorkspaceEditPlan) {
    setWorkspace((current) => {
      if (!current) {
        return current;
      }

      const paths = new Set(current.visibleFiles.map(normalizePath));
      const addedIndexPaths = new Set<string>();
      const removedIndexPaths = new Set<string>();
      for (const operation of plan.operations) {
        switch (operation.kind) {
          case "createFile":
            paths.add(normalizePath(operation.path));
            addedIndexPaths.add(normalizePath(operation.path));
            break;
          case "renameFile":
            paths.delete(normalizePath(operation.oldPath));
            paths.add(normalizePath(operation.newPath));
            removedIndexPaths.add(normalizePath(operation.oldPath));
            addedIndexPaths.add(normalizePath(operation.newPath));
            break;
          case "renameDirectory": {
            const affectedPaths = [...paths].filter((path) => pathWithinDirectory(path, operation.oldPath));
            affectedPaths.forEach((path) => {
              paths.delete(path);
              removedIndexPaths.add(path);
              const newPath = replaceDirectoryPrefix(path, operation.oldPath, operation.newPath);
              paths.add(newPath);
              addedIndexPaths.add(newPath);
            });
            break;
          }
          case "deleteFile":
            paths.delete(normalizePath(operation.path));
            removedIndexPaths.add(normalizePath(operation.path));
            break;
          case "deleteDirectory": {
            const affectedPaths = [...paths].filter((path) => pathWithinDirectory(path, operation.path));
            affectedPaths.forEach((path) => {
              paths.delete(path);
              removedIndexPaths.add(path);
            });
            break;
          }
          case "text":
            paths.add(normalizePath(operation.path));
            addedIndexPaths.add(normalizePath(operation.path));
            break;
          case "createDirectory":
            break;
        }
      }

      const visibleFiles = uniqueNormalizedPaths([...paths]);
      const nextWorkspace = {
        ...current,
        visibleFiles,
        fileTree: createFileTreeNodes(visibleFiles),
      };
      syncWorkspaceIndex(nextWorkspace);
      if (workspaceApi.updateWorkspaceIndexFiles) {
        void workspaceApi.updateWorkspaceIndexFiles(current.rootPath, [...addedIndexPaths], [...removedIndexPaths]).catch((error) => {
          onStatusChange(`Workspace index update failed: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return nextWorkspace;
    });
  }

  async function updateOpenTabsForAppliedEdit(plan: WorkspaceEditPlan) {
    let activePathAfterRename: string | null = null;
    let tabsChanged = false;

    for (const operation of plan.operations) {
      if (operation.kind !== "renameFile") {
        continue;
      }

      const oldPath = normalizePath(operation.oldPath);
      const newPath = normalizePath(operation.newPath);
      const tab = tabsRef.current.state.openTabs.find((entry) => normalizePath(entry.path) === oldPath);
      if (!tab) {
        continue;
      }

      const content = await workspaceApi.openFile(newPath);
      if (!documentsRef.current.getDocument(newPath)) {
        documentsRef.current.openDocument(newPath, content);
      } else {
        documentsRef.current.applyExternalChange(newPath, content);
      }

      tab.path = newPath;
      tab.title = getPathBasename(newPath);
      tab.isDirty = documentsRef.current.getDocument(newPath)?.isDirty ?? false;
      tabsRef.current.state.recentFiles = tabsRef.current.state.recentFiles.map((path) => (
        normalizePath(path) === oldPath ? newPath : path
      ));
      if (tabsRef.current.state.activePath && normalizePath(tabsRef.current.state.activePath) === oldPath) {
        tabsRef.current.state.activePath = newPath;
        activePathAfterRename = newPath;
      }
      tabsChanged = true;
    }

    if (tabsChanged) {
      syncTabs();
    }
    if (activePathAfterRename) {
      setActiveDocument(activePathAfterRename);
    }
  }

  async function applyWorkspaceEditPreview() {
    if (!workspaceEditPreview || workspaceEditApplyState === "applying") {
      return;
    }
    if (!workspace?.rootPath || !workspaceApi.applyWorkspaceEdit) {
      setWorkspaceEditApplyState("error");
      setWorkspaceEditMessage("Workspace edit apply is unavailable.");
      onStatusChange("Workspace edit apply unavailable");
      return;
    }

    setWorkspaceEditApplyState("applying");
    setWorkspaceEditMessage(undefined);
    onStatusChange(`Applying workspace edit: ${workspaceEditPreview.plan.title}`);

    try {
      const result = await workspaceApi.applyWorkspaceEdit({
        workspaceRoot: workspace.rootPath,
        plan: workspaceEditPreview.plan,
      });

      if (result.conflicts.length > 0 || !result.applied) {
        setWorkspaceEditApplyState("error");
        setWorkspaceEditPreview({
          ...workspaceEditPreview,
          conflicts: result.conflicts.length > 0 ? result.conflicts : workspaceEditPreview.conflicts,
        });
        const message = result.conflicts[0]?.message ?? "Workspace edit was not applied.";
        setWorkspaceEditMessage(message);
        onStatusChange(`Workspace edit failed: ${message}`);
        return;
      }

      updateWorkspaceFilesForAppliedEdit(workspaceEditPreview.plan);
      await updateOpenTabsForAppliedEdit(workspaceEditPreview.plan);
      await refreshAppliedWorkspaceEditFiles(result.changedFiles, workspaceEditPreview.plan);
      resetWorkspaceEdit();
      onStatusChange(`Workspace edit applied: ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"} changed`);
      focusEditorSoon();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceEditApplyState("error");
      setWorkspaceEditMessage(message);
      onStatusChange(`Workspace edit failed: ${message}`);
    }
  }

  async function previewWorkspaceMutationPlan(plan: WorkspaceEditPlan) {
    if (!workspace?.rootPath || !workspaceApi.previewWorkspaceEdit) {
      onStatusChange("Workspace edit preview unavailable");
      return;
    }

    const preview = await workspaceApi.previewWorkspaceEdit({
      workspaceRoot: workspace.rootPath,
      plan,
    });
    setWorkspaceEditPreview(preview);
    setWorkspaceEditApplyState("idle");
    setWorkspaceEditMessage(undefined);
    onStatusChange(`Preview ready: ${plan.title}`);
  }

  function openProjectMutationDialog(kind: "newFile" | "newDirectory", parentPath: string) {
    setProjectMutationDialog({ kind, parentPath, name: "" });
  }

  function openRootProjectMutationDialog(kind: "newFile" | "newDirectory") {
    if (!workspace?.rootPath) {
      onStatusChange("Open a project before creating files");
      return;
    }
    openProjectMutationDialog(kind, workspace.rootPath);
  }

  async function submitProjectMutationDialog() {
    if (!projectMutationDialog) {
      return;
    }

    const plan = projectMutationDialog.kind === "newFile"
      ? createNewFilePlan(projectMutationDialog.parentPath, projectMutationDialog.name)
      : createNewDirectoryPlan(projectMutationDialog.parentPath, projectMutationDialog.name);
    setProjectMutationDialog(null);
    await previewWorkspaceMutationPlan(plan);
  }

  async function showCodeActionsFromEditor(source: CodeActionsSource = "all") {
    if (settingsApplying) {
      onStatusChange("SDK settings are still applying");
      return;
    }
    if (!activePath || !workspaceApi.listCodeActions) {
      onStatusChange("Code actions unavailable");
      return;
    }

    const requestId = codeActionsRequestRef.current + 1;
    codeActionsRequestRef.current = requestId;
    const request = buildCodeActionsEditorRequest({ activePath, editorSelection, getActiveContent });

    clearCompletionSession();
    resetCompletionAnchor();
    closeOverlay();
    hideCurrentClassMethods();
    resetWorkspaceEdit();
    setCodeActions([]);
    setCodeActionsSelectedIndex(0);
    setCodeActionsMessage(undefined);
    setCodeActionsStatus("loading");
    setCodeActionsVisible(true);
    onStatusChange(codeActionsSourceStatus(source));

    try {
      const actions = await workspaceApi.listCodeActions(request);
      if (codeActionsRequestRef.current !== requestId) {
        return;
      }

      const visibleActions = filterCodeActionsForSource(actions, source);
      setCodeActions(visibleActions);
      setCodeActionsSelectedIndex(0);
      setCodeActionsStatus(visibleActions.length > 0 ? "ready" : "empty");
      setCodeActionsMessage(visibleActions.length > 0 ? undefined : emptyCodeActionsMessage(source));
      onStatusChange(visibleActions.length > 0 ? `Code Actions: ${visibleActions.length}` : "Code Actions: none");
    } catch (error) {
      if (codeActionsRequestRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      setCodeActions([]);
      setCodeActionsSelectedIndex(0);
      setCodeActionsStatus("error");
      setCodeActionsMessage(`Code actions failed: ${message}`);
      onStatusChange(`Code actions failed: ${message}`);
    }
  }

  async function resolveCodeActionFromPalette(action: CodeAction) {
    if (action.disabledReason) {
      onStatusChange(`Code action disabled: ${action.disabledReason}`);
      return;
    }
    if (!workspaceApi.resolveCodeAction) {
      onStatusChange("Resolve code action unavailable");
      return;
    }

    const requestId = codeActionResolveRequestRef.current + 1;
    codeActionResolveRequestRef.current = requestId;
    onStatusChange(`Resolving code action: ${action.title}`);
    try {
      const result = await workspaceApi.resolveCodeAction({ id: action.id, data: action.data });
      if (codeActionResolveRequestRef.current !== requestId) {
        return;
      }

      if (!isWorkspaceEditPlan(result)) {
        onStatusChange(`Code action unsupported: ${result.reason}`);
        return;
      }

      if (result.requiresPreview || requiresPreview(action)) {
        if (!workspace?.rootPath || !workspaceApi.previewWorkspaceEdit) {
          onStatusChange("Workspace edit preview unavailable");
          return;
        }

        const preview = await workspaceApi.previewWorkspaceEdit({
          workspaceRoot: workspace.rootPath,
          plan: result,
        });
        if (codeActionResolveRequestRef.current !== requestId) {
          return;
        }

        setWorkspaceEditPreview(preview);
        setWorkspaceEditApplyState("idle");
        setWorkspaceEditMessage(undefined);
        setCodeActionsVisible(false);
        onStatusChange(`Preview ready: ${result.title}`);
        return;
      }

      setCodeActionsVisible(false);
      onStatusChange(`Code action resolved: ${result.title}`);
      focusEditorSoon();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Resolve code action failed: ${message}`);
    }
  }

  return {
    codeActionsVisible,
    codeActions,
    codeActionsStatus,
    codeActionsMessage,
    codeActionsSelectedIndex,
    setCodeActionsSelectedIndex,
    workspaceEditPreview,
    workspaceEditApplyState,
    workspaceEditMessage,
    projectMutationDialog,
    setProjectMutationDialog,
    resetCodeActions,
    resetWorkspaceEdit,
    resetCodeActionSession,
    closeCodeActionsPalette,
    closeWorkspaceEditPreview,
    applyWorkspaceEditPreview,
    openProjectMutationDialog,
    openRootProjectMutationDialog,
    submitProjectMutationDialog,
    showCodeActionsFromEditor,
    resolveCodeActionFromPalette,
  };
}
