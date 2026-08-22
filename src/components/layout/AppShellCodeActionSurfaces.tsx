import type { ComponentProps } from "react";
import { CodeActionsPalette } from "@/components/layout/CodeActionsPalette";
import { WorkspaceEditPreview } from "@/components/layout/WorkspaceEditPreview";
import { RenameSymbolDialog } from "@/components/layout/RenameSymbolDialog";

export type AppShellCodeActionSurfacesProps = {
  codeActionsVisible: boolean;
  codeActionsProps: ComponentProps<typeof CodeActionsPalette>;
  workspaceEditPreview: ComponentProps<typeof WorkspaceEditPreview>["preview"] | null;
  workspaceEditProps: Omit<ComponentProps<typeof WorkspaceEditPreview>, "preview">;
  renameSymbolProps: ComponentProps<typeof RenameSymbolDialog> | null;
};

export function AppShellCodeActionSurfaces({
  codeActionsVisible,
  codeActionsProps,
  workspaceEditPreview,
  workspaceEditProps,
  renameSymbolProps,
}: AppShellCodeActionSurfacesProps) {
  return (
    <>
      {codeActionsVisible ? <CodeActionsPalette {...codeActionsProps} /> : null}
      {renameSymbolProps ? <RenameSymbolDialog {...renameSymbolProps} /> : null}
      {workspaceEditPreview ? <WorkspaceEditPreview preview={workspaceEditPreview} {...workspaceEditProps} /> : null}
    </>
  );
}
