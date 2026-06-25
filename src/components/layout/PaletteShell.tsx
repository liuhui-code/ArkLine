import type { PropsWithChildren } from "react";

type PaletteShellProps = PropsWithChildren<{
  label: string;
  description: string;
  onClose?: () => void;
}>;

export function PaletteShell({ label, description, onClose, children }: PaletteShellProps) {
  return (
    <section
      className="palette-shell"
      aria-label={`${label} Overlay`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose?.();
        }
      }}
    >
      <div
        className="palette-shell__panel"
        role="dialog"
        aria-label={label}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="palette-shell__header">
          <div>
            <strong>{label}</strong>
            <span>{description}</span>
          </div>
          <button
            type="button"
            className="palette-shell__close"
            aria-label={`Close ${label}`}
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="palette-shell__body">{children}</div>
      </div>
    </section>
  );
}
