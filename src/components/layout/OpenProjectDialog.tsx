type OpenProjectDialogProps = {
  open: boolean;
  errorMessage?: string | null;
  projectPath: string;
  onChangeProjectPath: (value: string) => void;
  onClose: () => void;
  onOpenProject: () => void;
};

export function OpenProjectDialog({
  open,
  errorMessage,
  projectPath,
  onChangeProjectPath,
  onClose,
  onOpenProject,
}: OpenProjectDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <section className="settings-dialog" aria-label="Open Project">
      <div className="settings-dialog__panel open-project-dialog">
        <header className="settings-dialog__header">
          <h2>Open Project</h2>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <label className="settings-field">
          <span>Project Path</span>
          <input
            aria-label="Project Path"
            autoFocus
            className="panel-input"
            value={projectPath}
            placeholder="C:\\HarmonyProjects\\MyApp"
            onChange={(event) => onChangeProjectPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && projectPath.trim()) {
                event.preventDefault();
                onOpenProject();
              }
            }}
          />
        </label>
        {errorMessage ? <p className="open-project-dialog__error">{errorMessage}</p> : null}
        <div className="open-project-dialog__actions">
          <button type="button" className="toolbar__button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="toolbar__button toolbar__button--primary"
            onClick={onOpenProject}
            disabled={projectPath.trim().length === 0}
          >
            Open Project
          </button>
        </div>
      </div>
    </section>
  );
}
