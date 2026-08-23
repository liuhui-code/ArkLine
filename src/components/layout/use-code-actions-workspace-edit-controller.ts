import { useRef, useState } from "react";
import { buildAppliedWorkspaceEditUpdate } from "@/components/layout/workspace-edit-application-model";
import {
  buildCodeActionsEditorSnapshot,
  codeActionsSourceStatus,
  emptyCodeActionsMessage,
  filterCodeActionsForSource,
  type CodeActionsSource,
} from "@/components/layout/code-actions-request-model";
import { languageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";
import {
  isWorkspaceEditPlan,
  type CodeActionsStatus,
  type ProjectMutationDialogState,
} from "@/components/layout/app-shell-types";
import type { UseCodeActionsWorkspaceEditControllerOptions } from "@/components/layout/code-actions-controller-types";
import { requiresPreview, type CodeAction, type WorkspaceEditPlan } from "@/features/code-actions/code-action-model";
import { createNewDirectoryPlan, createNewFilePlan } from "@/features/workspace/workspace-mutation-plans";
import type { WorkspaceEditPreview as WorkspaceEditPreviewModel } from "@/features/workspace/workspace-api";
import { getPathBasename, normalizePath } from "@/features/workspace/workspace-store";

export function useCodeActionsWorkspaceEditController({
  workspace,
  workspaceApi,
  activePath,
  editorSelection,
  settingsApplying,
  getActiveContent,
  ensureSemanticDocument,
  documentsRef,
  tabsRef,
  setWorkspace,
  syncTabs,
  syncWorkspaceIndex,
  setActiveDocument,
  closeCompletion,
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
  const [workspaceEditApplyState, setWorkspaceEditApplyState] = useState<"idle" | "applying" | "error" | "applied" | "undoing">("idle");
  const [workspaceEditMessage, setWorkspaceEditMessage] = useState<string | undefined>();
  const [workspaceEditUndoPlan, setWorkspaceEditUndoPlan] = useState<WorkspaceEditPlan | null>(null);
  const [projectMutationDialog, setProjectMutationDialog] = useState<ProjectMutationDialogState | null>(null);
  const [renameSymbolDialog, setRenameSymbolDialog] = useState<{ name: string; pending: boolean; message?: string } | null>(null);
  function resetWorkspaceEdit() {
    setWorkspaceEditPreview(null);
    setWorkspaceEditApplyState("idle");
    setWorkspaceEditMessage(undefined);
    setWorkspaceEditUndoPlan(null);
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
    if (workspaceEditApplyState === "applying" || workspaceEditApplyState === "undoing") {
      return;
    }

    resetWorkspaceEdit();
    focusEditorSoon();
  }

  function openRenameSymbolDialog() {
    if (settingsApplying || !activePath || !workspace?.rootPath || !workspaceApi.renameSymbol) {
      onStatusChange("Rename Symbol unavailable");
      return;
    }
    closeCompletion();
    closeOverlay();
    hideCurrentClassMethods();
    resetCodeActions();
    resetWorkspaceEdit();
    setRenameSymbolDialog({ name: "", pending: false });
    onStatusChange("Rename Symbol");
  }

  function closeRenameSymbolDialog() {
    if (renameSymbolDialog?.pending) return;
    setRenameSymbolDialog(null);
    focusEditorSoon();
  }

  async function submitRenameSymbol() {
    if (!renameSymbolDialog || renameSymbolDialog.pending || !activePath || !workspace?.rootPath
      || !workspaceApi.renameSymbol || !workspaceApi.previewWorkspaceEdit) return;
    const newName = renameSymbolDialog.name.trim();
    if (!newName) return;
    setRenameSymbolDialog({ ...renameSymbolDialog, pending: true, message: undefined });
    const snapshot = buildCodeActionsEditorSnapshot({ activePath, editorSelection, getActiveContent });
    try {
      const documentVersion = ensureSemanticDocument
        ? await ensureSemanticDocument(activePath, getActiveContent())
        : null;
      const result = await workspaceApi.renameSymbol({
        ...snapshot.request,
        content: documentVersion === null ? snapshot.request.content : undefined,
        newName,
        ...(documentVersion === null ? {} : { documentVersion }),
      });
      if (result.availability !== "ready") {
        const message = result.message ?? "Semantic rename is not authoritative";
        setRenameSymbolDialog({ name: newName, pending: false, message });
        onStatusChange(`Rename Symbol unavailable: ${message}`);
        return;
      }
      const resolution = result.resolution;
      if (!resolution || !isWorkspaceEditPlan(resolution)) {
        const message = resolution?.reason ?? result.message ?? "Rename Symbol unavailable";
        setRenameSymbolDialog({ name: newName, pending: false, message });
        onStatusChange(`Rename Symbol unavailable: ${message}`);
        return;
      }
      const preview = await workspaceApi.previewWorkspaceEdit({ workspaceRoot: workspace.rootPath, plan: resolution });
      setRenameSymbolDialog(null);
      setWorkspaceEditPreview(preview);
      setWorkspaceEditApplyState("idle");
      setWorkspaceEditMessage(undefined);
      onStatusChange(`Preview ready: ${resolution.title}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setRenameSymbolDialog({ name: newName, pending: false, message });
      onStatusChange(`Rename Symbol failed: ${message}`);
    }
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

      const update = buildAppliedWorkspaceEditUpdate({ visibleFiles: current.visibleFiles, plan });
      const nextWorkspace = {
        ...current,
        visibleFiles: update.visibleFiles,
        fileTree: update.fileTree,
      };
      syncWorkspaceIndex(nextWorkspace);
      if (workspaceApi.updateWorkspaceIndexFiles) {
        void workspaceApi.updateWorkspaceIndexFiles(current.rootPath, update.addedIndexPaths, update.removedIndexPaths).catch((error) => {
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
      const appliedMessage = `Workspace edit applied: ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"} changed`;
      if (result.undoPlan) {
        setWorkspaceEditUndoPlan(result.undoPlan);
        setWorkspaceEditApplyState("applied");
        setWorkspaceEditMessage("Applied. One safe undo is available.");
        onStatusChange(appliedMessage);
      } else {
        resetWorkspaceEdit();
        onStatusChange(appliedMessage);
        focusEditorSoon();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceEditApplyState("error");
      setWorkspaceEditMessage(message);
      onStatusChange(`Workspace edit failed: ${message}`);
    }
  }

  async function undoWorkspaceEdit() {
    if (!workspaceEditUndoPlan || !workspace?.rootPath || !workspaceApi.applyWorkspaceEdit
      || workspaceEditApplyState === "undoing") return;
    setWorkspaceEditApplyState("undoing");
    setWorkspaceEditMessage(undefined);
    try {
      const result = await workspaceApi.applyWorkspaceEdit({ workspaceRoot: workspace.rootPath, plan: workspaceEditUndoPlan });
      if (!result.applied || result.conflicts.length > 0) {
        const message = result.conflicts[0]?.message ?? "Workspace edit could not be undone.";
        setWorkspaceEditApplyState("applied");
        setWorkspaceEditMessage(message);
        onStatusChange(`Workspace edit undo blocked: ${message}`);
        return;
      }
      updateWorkspaceFilesForAppliedEdit(workspaceEditUndoPlan);
      await updateOpenTabsForAppliedEdit(workspaceEditUndoPlan);
      await refreshAppliedWorkspaceEditFiles(result.changedFiles, workspaceEditUndoPlan);
      const message = `Workspace edit undone: ${result.changedFiles.length} file${result.changedFiles.length === 1 ? "" : "s"} changed`;
      resetWorkspaceEdit();
      onStatusChange(message);
      focusEditorSoon();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setWorkspaceEditApplyState("applied");
      setWorkspaceEditMessage(message);
      onStatusChange(`Workspace edit undo failed: ${message}`);
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
    const snapshot = buildCodeActionsEditorSnapshot({ activePath, editorSelection, getActiveContent });
    languageQuerySnapshotStore.record({ kind: "codeActions", snapshot });
    const request = snapshot.request;

    closeCompletion();
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
    renameSymbolDialog,
    setRenameSymbolDialog,
    resetCodeActions,
    resetWorkspaceEdit,
    resetCodeActionSession,
    closeCodeActionsPalette,
    closeWorkspaceEditPreview,
    applyWorkspaceEditPreview,
    undoWorkspaceEdit,
    openRenameSymbolDialog,
    closeRenameSymbolDialog,
    submitRenameSymbol,
    openProjectMutationDialog,
    openRootProjectMutationDialog,
    submitProjectMutationDialog,
    previewWorkspaceMutationPlan,
    showCodeActionsFromEditor,
    resolveCodeActionFromPalette,
  };
}
