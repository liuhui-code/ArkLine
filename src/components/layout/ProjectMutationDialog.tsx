import type { ProjectMutationDialogState } from "@/components/layout/app-shell-types";

type ProjectMutationDialogProps = {
  state: ProjectMutationDialogState;
  onChangeName: (name: string) => void;
  onClose: () => void;
  onSubmit: () => void;
};

export function ProjectMutationDialog({
  state,
  onChangeName,
  onClose,
  onSubmit,
}: ProjectMutationDialogProps) {
  const title = state.kind === "newFile" ? "New File" : "New Directory";
  const label = state.kind === "newFile" ? "New File Name" : "New Directory Name";

  return (
    <section className="project-mutation-dialog" role="dialog" aria-modal="true" aria-label={title}>
      <form
        className="project-mutation-dialog__panel"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <header className="project-mutation-dialog__header">
          <div>
            <h2>{title}</h2>
            <span>{state.parentPath}</span>
          </div>
          <button type="button" aria-label={`Close ${title}`} onClick={onClose}>×</button>
        </header>
        <label className="project-mutation-dialog__field">
          <span>{label}</span>
          <input
            aria-label={label}
            autoFocus
            value={state.name}
            onChange={(event) => onChangeName(event.target.value)}
          />
        </label>
        <footer className="project-mutation-dialog__footer">
          <button type="button" className="button-secondary" onClick={onClose}>Cancel</button>
          <button type="submit">Preview</button>
        </footer>
      </form>
    </section>
  );
}
