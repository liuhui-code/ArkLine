type OpenProjectDecisionDialogProps = {
  open: boolean;
  projectName: string;
  onChooseThisWindow: () => void;
  onChooseNewWindow: () => void;
  onCancel: () => void;
};

export function OpenProjectDecisionDialog({
  open,
  projectName,
  onChooseThisWindow,
  onChooseNewWindow,
  onCancel,
}: OpenProjectDecisionDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <section
      className="settings-dialog"
      aria-label="Open Project Decision"
      role="dialog"
      aria-modal="true"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
    >
      <div className="settings-dialog__panel open-project-dialog">
        <header className="settings-dialog__header">
          <h2>Open Project</h2>
        </header>
        <p>{`Open "${projectName}" in this window or a new window?`}</p>
        <div className="open-project-dialog__actions">
          <button type="button" className="toolbar__button" onClick={onChooseThisWindow}>
            This Window
          </button>
          <button type="button" className="toolbar__button toolbar__button--primary" onClick={onChooseNewWindow}>
            New Window
          </button>
          <button type="button" className="toolbar__button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </section>
  );
}
