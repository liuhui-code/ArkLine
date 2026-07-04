import type { ComponentProps } from "react";
import { CodeActionsPalette } from "@/components/layout/CodeActionsPalette";
import { AppShellCodeActionSurfaces } from "@/components/layout/AppShellCodeActionSurfaces";
import { CompletionPopup } from "@/components/layout/CompletionPopup";
import { CurrentClassMethodsPalette } from "@/components/layout/CurrentClassMethodsPalette";
import { GitBlameCard } from "@/components/layout/GitBlameCard";
import { OpenProjectDecisionDialog } from "@/components/layout/OpenProjectDecisionDialog";
import { OpenProjectDialog } from "@/components/layout/OpenProjectDialog";
import { ProjectMutationDialog } from "@/components/layout/ProjectMutationDialog";
import { SearchOverlayContent } from "@/components/layout/SearchOverlayContent";
import { AppShellSearchOverlaySurface } from "@/components/layout/AppShellSearchOverlaySurface";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { WorkspaceEditPreview } from "@/components/layout/WorkspaceEditPreview";
import type { ProjectMutationDialogState } from "@/components/layout/app-shell-types";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";

type AppShellOverlaysProps = {
  selectedBlameAttribution: ComponentProps<typeof GitBlameCard>["attribution"] | null;
  onCloseBlameCard: () => void;
  onShowSelectedBlameCommit: () => void;
  onShowSelectedBlameDiff: () => void;
  onShowSelectedLocalDiff: () => void;
  onCopySelectedBlameHash: () => void;
  completionPopupVisible: boolean;
  completionPopupProps: ComponentProps<typeof CompletionPopup>;
  overlayVisible: boolean;
  activeOverlay: OverlayKey;
  overlayLabel: string;
  onCloseOverlay: () => void;
  commandPaletteItems: CommandPaletteItem[];
  searchOverlayProps: Omit<
    ComponentProps<typeof SearchOverlayContent>,
    "activeOverlay" | "commandPaletteItems" | "onCloseOverlay"
  >;
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
  openProjectDialogProps: ComponentProps<typeof OpenProjectDialog>;
  openProjectDecisionDialogProps: ComponentProps<typeof OpenProjectDecisionDialog>;
  settingsDialogProps: ComponentProps<typeof SettingsDialog>;
};

export function AppShellOverlays({
  selectedBlameAttribution,
  onCloseBlameCard,
  onShowSelectedBlameCommit,
  onShowSelectedBlameDiff,
  onShowSelectedLocalDiff,
  onCopySelectedBlameHash,
  completionPopupVisible,
  completionPopupProps,
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
  openProjectDialogProps,
  openProjectDecisionDialogProps,
  settingsDialogProps,
}: AppShellOverlaysProps) {
  return (
    <>
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
      {completionPopupVisible ? <CompletionPopup {...completionPopupProps} /> : null}
      <AppShellSearchOverlaySurface visible={overlayVisible} activeOverlay={activeOverlay} label={overlayLabel} onClose={onCloseOverlay} commandPaletteItems={commandPaletteItems} searchOverlayProps={searchOverlayProps} />
      {projectMutationDialog ? (
        <ProjectMutationDialog
          state={projectMutationDialog}
          onChangeName={onChangeProjectMutationName}
          onClose={onCloseProjectMutationDialog}
          onSubmit={onSubmitProjectMutationDialog}
        />
      ) : null}
      {currentMethodsVisible ? <CurrentClassMethodsPalette {...currentMethodsProps} /> : null}
      <AppShellCodeActionSurfaces codeActionsVisible={codeActionsVisible} codeActionsProps={codeActionsProps} workspaceEditPreview={workspaceEditPreview} workspaceEditProps={workspaceEditProps} />
      <OpenProjectDialog {...openProjectDialogProps} />
      <OpenProjectDecisionDialog {...openProjectDecisionDialogProps} />
      <SettingsDialog {...settingsDialogProps} />
    </>
  );
}
