import type { ComponentProps } from "react";
import { CodeActionsPalette } from "@/components/layout/CodeActionsPalette";
import { AppShellCodeActionSurfaces } from "@/components/layout/AppShellCodeActionSurfaces";
import { CurrentClassMethodsPalette } from "@/components/layout/CurrentClassMethodsPalette";
import { GitBlameCard } from "@/components/layout/GitBlameCard";
import { GitBranchPicker } from "@/components/layout/GitBranchPicker";
import { GitPushDialog } from "@/components/layout/GitPushDialog";
import type { GitPushController } from "@/components/layout/use-git-push-controller";
import { OpenProjectDecisionDialog } from "@/components/layout/OpenProjectDecisionDialog";
import { OpenProjectDialog } from "@/components/layout/OpenProjectDialog";
import { ProjectMutationDialog } from "@/components/layout/ProjectMutationDialog";
import type { NonSearchOverlayContentProps } from "@/components/layout/NonSearchOverlayContent";
import { AppShellSearchOverlaySurface } from "@/components/layout/AppShellSearchOverlaySurface";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { WorkspaceEditPreview } from "@/components/layout/WorkspaceEditPreview";
import { RenameSymbolDialog } from "@/components/layout/RenameSymbolDialog";
import type { ProjectMutationDialogState } from "@/components/layout/app-shell-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";
import { recordRenderPressure } from "@/features/performance/use-ui-latency-monitor";

type AppShellOverlaysProps = {
  gitPushController: GitPushController;
  selectedBlameAttribution: ComponentProps<typeof GitBlameCard>["attribution"] | null;
  onCloseBlameCard: () => void;
  onShowSelectedBlameCommit: () => void;
  onShowSelectedBlameDiff: () => void;
  onShowSelectedLocalDiff: () => void;
  onCopySelectedBlameHash: () => void;
  overlayVisible: boolean;
  activeOverlay: OverlayKey;
  overlayLabel: string;
  onCloseOverlay: () => void;
  commandPaletteItems: CommandPaletteItem[];
  searchOverlayProps?: Omit<NonSearchOverlayContentProps, "activeOverlay" | "label" | "commandPaletteItems" | "onClose">;
  projectMutationDialog: ProjectMutationDialogState | null;
  onChangeProjectMutationName: (name: string) => void;
  onCloseProjectMutationDialog: () => void;
  onSubmitProjectMutationDialog: () => void;
  currentMethodsVisible: boolean;
  currentMethodsProps: ComponentProps<typeof CurrentClassMethodsPalette>;
  codeActionsVisible: boolean;
  codeActionsProps: ComponentProps<typeof CodeActionsPalette>;
  workspaceEditPreview: ComponentProps<typeof WorkspaceEditPreview>["preview"] | null;
  workspaceEditProps: Omit<ComponentProps<typeof WorkspaceEditPreview>, "preview">;
  renameSymbolProps: ComponentProps<typeof RenameSymbolDialog> | null;
  openProjectDialogProps: ComponentProps<typeof OpenProjectDialog>;
  openProjectDecisionDialogProps: ComponentProps<typeof OpenProjectDecisionDialog>;
  settingsDialogProps: ComponentProps<typeof SettingsDialog>;
  gitBranchPickerProps: ComponentProps<typeof GitBranchPicker>;
};

export function AppShellOverlays({
  gitPushController,
  selectedBlameAttribution,
  onCloseBlameCard,
  onShowSelectedBlameCommit,
  onShowSelectedBlameDiff,
  onShowSelectedLocalDiff,
  onCopySelectedBlameHash,
  overlayVisible,
  activeOverlay,
  overlayLabel,
  onCloseOverlay,
  commandPaletteItems,
  searchOverlayProps,
  projectMutationDialog,
  onChangeProjectMutationName,
  onCloseProjectMutationDialog,
  onSubmitProjectMutationDialog,
  currentMethodsVisible,
  currentMethodsProps,
  codeActionsVisible,
  codeActionsProps,
  workspaceEditPreview,
  workspaceEditProps,
  renameSymbolProps,
  openProjectDialogProps,
  openProjectDecisionDialogProps,
  settingsDialogProps,
  gitBranchPickerProps,
}: AppShellOverlaysProps) {
  recordRenderPressure("AppShell/Overlays");
  return (
    <>
      <GitPushDialog push={gitPushController} />
      {selectedBlameAttribution ? (
        <GitBlameCard
          attribution={selectedBlameAttribution}
          onClose={onCloseBlameCard}
          onShowCommit={onShowSelectedBlameCommit}
          onShowDiff={onShowSelectedBlameDiff}
          onShowLocalDiff={onShowSelectedLocalDiff}
          onCopyHash={onCopySelectedBlameHash}
        />
      ) : null}
      <GitBranchPicker {...gitBranchPickerProps} />
      {overlayVisible && searchOverlayProps ? <AppShellSearchOverlaySurface visible activeOverlay={activeOverlay} label={overlayLabel} onClose={onCloseOverlay} commandPaletteItems={commandPaletteItems} searchOverlayProps={searchOverlayProps} /> : null}
      {projectMutationDialog ? (
        <ProjectMutationDialog
          state={projectMutationDialog}
          onChangeName={onChangeProjectMutationName}
          onClose={onCloseProjectMutationDialog}
          onSubmit={onSubmitProjectMutationDialog}
        />
      ) : null}
      {currentMethodsVisible ? <CurrentClassMethodsPalette {...currentMethodsProps} /> : null}
      <AppShellCodeActionSurfaces codeActionsVisible={codeActionsVisible} codeActionsProps={codeActionsProps} workspaceEditPreview={workspaceEditPreview} workspaceEditProps={workspaceEditProps} renameSymbolProps={renameSymbolProps} />
      <OpenProjectDialog {...openProjectDialogProps} />
      <OpenProjectDecisionDialog {...openProjectDecisionDialogProps} />
      <SettingsDialog {...settingsDialogProps} />
    </>
  );
}
