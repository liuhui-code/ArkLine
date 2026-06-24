import type { CompletionPresentation } from "@/components/layout/completion-model";
import type { EditorCaretRect } from "@/editor/editor-events";

type CompletionPopupProps = {
  items: CompletionPresentation[];
  selectedIndex: number;
  position: { top: number; left: number };
  anchor: EditorCaretRect | null;
  status: "loading" | "ready" | "empty" | "error";
  message?: string;
  detailsVisible: boolean;
  onAccept: (item: CompletionPresentation) => void;
  onSelect: (index: number) => void;
};

export function CompletionPopup({
  items,
  selectedIndex,
  position,
  anchor,
  status,
  message,
  detailsVisible,
  onAccept,
  onSelect,
}: CompletionPopupProps) {
  const selectedItem = items[selectedIndex] ?? null;
  const activeOptionId = selectedItem ? completionOptionId(selectedItem.id) : undefined;

  return (
    <div
      className="completion-popup"
      role="listbox"
      aria-label="Code Completion"
      aria-activedescendant={activeOptionId}
      data-anchor={anchor?.measured ? "editor-caret" : "fallback"}
      data-anchor-line={anchor?.line ?? 0}
      data-anchor-column={anchor?.column ?? 0}
      style={{ top: position.top, left: position.left }}
    >
      {status === "ready" ? (
        items.map((item, index) => (
          <div
            key={item.id}
            id={completionOptionId(item.id)}
            className={`completion-popup__option${index === selectedIndex ? " completion-popup__option--selected" : ""}`}
            role="option"
            aria-selected={index === selectedIndex}
            onMouseEnter={() => onSelect(index)}
            onMouseDown={(event) => {
              event.preventDefault();
              onAccept(item);
            }}
          >
            <span className="completion-popup__kind">{item.kindLabel}</span>
            <span className="completion-popup__label">{item.label}</span>
            <span className="completion-popup__source">{item.sourceLabel}</span>
            {detailsVisible && index === selectedIndex ? null : (
              <span className="completion-popup__detail">{item.detail}</span>
            )}
          </div>
        ))
      ) : (
        <div className={`completion-popup__state completion-popup__state--${status}`}>
          {message ?? statusLabel(status)}
        </div>
      )}
      {detailsVisible && selectedItem ? (
        <div className="completion-popup__details">
          <div className="completion-popup__details-signature">{selectedItem.detail}</div>
          {selectedItem.documentation ? (
            <div className="completion-popup__details-doc">{selectedItem.documentation}</div>
          ) : null}
          {selectedItem.definitionTarget ? (
            <div className="completion-popup__details-source">
              {`${selectedItem.definitionTarget.path.split(/[\\/]/).at(-1)}:${selectedItem.definitionTarget.line}:${selectedItem.definitionTarget.column}`}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function statusLabel(status: CompletionPopupProps["status"]) {
  if (status === "loading") {
    return "Loading completions";
  }
  if (status === "empty") {
    return "No completions";
  }
  return "Completion failed";
}

function completionOptionId(itemId: string) {
  return `completion-option-${itemId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
