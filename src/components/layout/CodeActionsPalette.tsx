import { useEffect, useRef, type KeyboardEvent } from "react";
import { PaletteShell } from "@/components/layout/PaletteShell";
import { formatCodeActionKind, type CodeAction } from "@/features/code-actions/code-action-model";

type CodeActionsPaletteProps = {
  actions: CodeAction[];
  status: "loading" | "ready" | "empty" | "error";
  message?: string;
  selectedIndex: number;
  onClose: () => void;
  onResolveAction: (action: CodeAction) => void;
  onSelectIndex: (index: number) => void;
};

export function CodeActionsPalette({
  actions,
  status,
  message,
  selectedIndex,
  onClose,
  onResolveAction,
  onSelectIndex,
}: CodeActionsPaletteProps) {
  const paletteRef = useRef<HTMLDivElement | null>(null);
  const selectedAction = actions[Math.min(selectedIndex, Math.max(actions.length - 1, 0))] ?? null;

  useEffect(() => {
    paletteRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (actions.length === 0) {
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      onSelectIndex((selectedIndex + direction + actions.length) % actions.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedAction && !selectedAction.disabledReason) {
        onResolveAction(selectedAction);
      }
    }
  }

  return (
    <PaletteShell label="Code Actions" description="Alt+Enter" onClose={onClose}>
      <div
        ref={paletteRef}
        className="code-actions-palette"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {status === "loading" ? <div className="code-actions-palette__state">Loading code actions...</div> : null}
        {status === "error" ? <div className="code-actions-palette__state code-actions-palette__state--error">{message ?? "Code actions failed"}</div> : null}
        {status === "empty" ? <div className="code-actions-palette__state">No code actions available</div> : null}
        {status === "ready" ? (
          <div className="code-actions-palette__results" role="listbox" aria-label="Code Actions">
            {actions.map((action, index) => (
              <button
                key={action.id}
                type="button"
                role="option"
                aria-selected={index === selectedIndex}
                aria-disabled={action.disabledReason ? "true" : undefined}
                className={`code-actions-palette__item${index === selectedIndex ? " code-actions-palette__item--selected" : ""}${action.disabledReason ? " code-actions-palette__item--disabled" : ""}`}
                onMouseEnter={() => onSelectIndex(index)}
                onClick={() => {
                  if (!action.disabledReason) {
                    onResolveAction(action);
                  }
                }}
              >
                <span className="code-actions-palette__title">{action.title}</span>
                <span className="code-actions-palette__kind">{formatCodeActionKind(action.kind)}</span>
                {action.disabledReason ? <span className="code-actions-palette__disabled">{action.disabledReason}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </PaletteShell>
  );
}
