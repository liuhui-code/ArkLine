import { useState } from "react";
import { getPathBasename } from "@/features/workspace/workspace-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

type UseProjectOpeningArgs = {
  canUseNativeProjectPicker: boolean;
  hasWorkspace: boolean;
  workspaceApi: WorkspaceApi;
  workspaceRootPath: string | null;
  openWorkspace: (rootPath: string) => Promise<void>;
  focusEditorSoon: () => void;
  onBeforeProjectOpen: () => void;
  onStatusChange: (status: string) => void;
};

export function useProjectOpening({
  canUseNativeProjectPicker,
  hasWorkspace,
  workspaceApi,
  workspaceRootPath,
  openWorkspace,
  focusEditorSoon,
  onBeforeProjectOpen,
  onStatusChange,
}: UseProjectOpeningArgs) {
  const [projectPathInput, setProjectPathInput] = useState("");
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectOpenError, setProjectOpenError] = useState<string | null>(null);
  const [projectDecisionVisible, setProjectDecisionVisible] = useState(false);
  const [pendingProjectPath, setPendingProjectPath] = useState<string | null>(null);

  async function requestProjectOpen(rootPath: string) {
    onBeforeProjectOpen();
    if (!hasWorkspace) {
      await openWorkspace(rootPath);
      return;
    }

    setProjectPickerVisible(false);
    setProjectOpenError(null);
    setPendingProjectPath(rootPath);
    setProjectDecisionVisible(true);
  }

  async function openProjectPicker() {
    onStatusChange("Open Project");
    setProjectOpenError(null);
    if (canUseNativeProjectPicker) {
      const rootPath = await workspaceApi.pickWorkspaceRoot();
      if (rootPath) {
        await requestProjectOpen(rootPath);
      }
      return;
    }

    setProjectPathInput(workspaceRootPath ?? "");
    setProjectPickerVisible(true);
  }

  async function confirmOpenProject() {
    const rootPath = projectPathInput.trim();
    if (rootPath) {
      await requestProjectOpen(rootPath);
    }
  }

  async function openPendingProjectInThisWindow() {
    const rootPath = pendingProjectPath;
    setProjectDecisionVisible(false);
    setPendingProjectPath(null);
    if (rootPath) {
      await openWorkspace(rootPath);
    }
  }

  async function openPendingProjectInNewWindow() {
    const rootPath = pendingProjectPath;
    setProjectDecisionVisible(false);
    setPendingProjectPath(null);
    if (!rootPath) {
      return;
    }

    if (workspaceApi.openWorkspaceInNewWindow) {
      await workspaceApi.openWorkspaceInNewWindow(rootPath);
    }
    onStatusChange(`Opened ${getPathBasename(rootPath)} in a new window`);
    focusEditorSoon();
  }

  function cancelPendingProjectOpen() {
    setProjectDecisionVisible(false);
    setPendingProjectPath(null);
    focusEditorSoon();
  }

  function closeProjectPicker() {
    setProjectPickerVisible(false);
    setProjectOpenError(null);
  }

  return {
    projectPathInput,
    projectPickerVisible,
    projectOpenError,
    projectDecisionVisible,
    pendingProjectPath,
    setProjectPathInput,
    setProjectOpenError,
    requestProjectOpen,
    openProjectPicker,
    confirmOpenProject,
    openPendingProjectInThisWindow,
    openPendingProjectInNewWindow,
    cancelPendingProjectOpen,
    closeProjectPicker,
  };
}
