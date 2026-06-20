type MainWorkspaceViewProps = {
  workspaceName?: string | null;
};

export function MainWorkspaceView({ workspaceName }: MainWorkspaceViewProps) {
  const title = workspaceName ?? "Welcome";
  const description = workspaceName
    ? `Workspace ${workspaceName} is open and ready for review.`
    : "Open a HarmonyOS workspace to start reviewing and editing ArkTS files.";

  return (
    <div className="workspace-empty">
      <div className="workspace-empty__content">
        <span className="workspace-empty__eyebrow">ArkTS Workspace</span>
        <strong className="workspace-empty__title">{title}</strong>
        <p className="workspace-empty__description">{description}</p>
        <div className="workspace-empty__ghost" aria-hidden="true">
          <span className="workspace-empty__ghost-line workspace-empty__ghost-line--short" />
          <span className="workspace-empty__ghost-line workspace-empty__ghost-line--medium" />
          <span className="workspace-empty__ghost-line workspace-empty__ghost-line--long" />
        </div>
      </div>
    </div>
  );
}
