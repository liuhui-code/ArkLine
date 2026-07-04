import type { ComponentProps } from "react";
import { CodeActionsPalette } from "@/components/layout/CodeActionsPalette";
import { WorkspaceEditPreview } from "@/components/layout/WorkspaceEditPreview";

export type AppShellCodeActionSurfacesProps = {
  codeActionsVisible: boolean;
  codeActionsProps: ComponentProps<typeof CodeActionsPalette>;
  workspaceEditPreview: ComponentProps<typeof WorkspaceEditPreview>["preview"] | null;
  workspaceEditProps: Omit<ComponentProps<typeof WorkspaceEditPreview>, "preview">;
};

export function AppShellCodeActionSurfaces({
  codeActionsVisible,
  codeActionsProps,
  workspaceEditPreview,
  workspaceEditProps,
}: AppShellCodeActionSurfacesProps) {
  return (
    <>
      {codeActionsVisible ? <CodeActionsPalette {...codeActionsProps} /> : null}
      {workspaceEditPreview ? <WorkspaceEditPreview preview={workspaceEditPreview} {...workspaceEditProps} /> : null}
    </>
  );
}
