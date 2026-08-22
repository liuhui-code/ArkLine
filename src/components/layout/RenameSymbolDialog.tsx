type RenameSymbolDialogProps = {
  name: string;
  pending: boolean;
  message?: string;
  onChangeName: (name: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function RenameSymbolDialog({ name, pending, message, onChangeName, onClose, onSubmit }: RenameSymbolDialogProps) {
  return (
    <section className="project-mutation-dialog" role="dialog" aria-modal="true" aria-label="Rename Symbol">
      <form className="project-mutation-dialog__panel" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
        <header className="project-mutation-dialog__header">
          <div>
            <h2>Rename Symbol</h2>
            <span>Preview all semantic references before applying.</span>
          </div>
          <button type="button" aria-label="Close Rename Symbol" disabled={pending} onClick={onClose}>×</button>
        </header>
        <label className="project-mutation-dialog__field">
          <span>New Symbol Name</span>
          <input aria-label="New Symbol Name" autoFocus disabled={pending} value={name} onChange={(event) => onChangeName(event.target.value)} />
        </label>
        {message ? <div role="status">{message}</div> : null}
        <footer className="project-mutation-dialog__footer">
          <button type="button" className="button-secondary" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={pending || name.trim().length === 0}>{pending ? "Preparing..." : "Preview"}</button>
        </footer>
      </form>
    </section>
  );
}
