import { useSyncExternalStore } from "react";
import type { CompletionPresentation } from "@/components/layout/completion-model";
import { getCompletionPopupPosition } from "@/components/layout/app-shell-model";
import type { CompletionAnchorStore } from "@/features/editor/completion-anchor-store";

type CompletionPopupProps = {
  items: CompletionPresentation[];
  selectedIndex: number;
  anchorStore: CompletionAnchorStore;
  status: "loading" | "ready" | "empty" | "error";
  message?: string;
  detailsVisible: boolean;
  onAccept: (item: CompletionPresentation) => void;
  onSelect: (index: number) => void;
};

export function CompletionPopup({
  items,
  selectedIndex,
  anchorStore,
  status,
  message,
  detailsVisible,
  onAccept,
  onSelect,
}: CompletionPopupProps) {
  const anchor = useSyncExternalStore(
    anchorStore.subscribe,
    anchorStore.getSnapshot,
    anchorStore.getSnapshot,
  );
  const position = getCompletionPopupPosition(anchor);
  const selectedItem = items[selectedIndex] ?? null;
  const activeOptionId = selectedItem ? completionOptionId(selectedItem.id) : undefined;
  const detailsId = selectedItem ? completionDetailsId(selectedItem.id) : undefined;

  return (
    <div
      className="completion-popup"
      data-anchor={anchor?.measured ? "editor-caret" : "fallback"}
      data-anchor-line={anchor?.line ?? 0}
      data-anchor-column={anchor?.column ?? 0}
      style={{ top: position.top, left: position.left }}
    >
      {status === "ready" ? (
        <div
          className="completion-popup__list"
          role="listbox"
          aria-label="Code Completion"
          aria-activedescendant={activeOptionId}
          data-anchor={anchor?.measured ? "editor-caret" : "fallback"}
          data-anchor-line={anchor?.line ?? 0}
          data-anchor-column={anchor?.column ?? 0}
          style={{ top: position.top, left: position.left }}
        >
          {items.map((item, index) => (
            <div
              key={item.id}
              id={completionOptionId(item.id)}
              className={`completion-popup__option${index === selectedIndex ? " completion-popup__option--selected" : ""}`}
              role="option"
              aria-selected={index === selectedIndex}
              aria-describedby={detailsVisible && index === selectedIndex ? detailsId : undefined}
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
          ))}
        </div>
      ) : (
        <div
          className={`completion-popup__state completion-popup__state--${status}`}
          role="status"
          data-anchor={anchor?.measured ? "editor-caret" : "fallback"}
          data-anchor-line={anchor?.line ?? 0}
          data-anchor-column={anchor?.column ?? 0}
          style={{ top: position.top, left: position.left }}
        >
          {message ?? statusLabel(status)}
        </div>
      )}
      {detailsVisible && selectedItem ? (
        <aside
          id={detailsId}
          className="completion-popup__details"
          aria-label="Completion Details"
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="completion-popup__details-signature">{selectedItem.detail}</div>
          {selectedItem.documentation ? (
            <div className="completion-popup__details-doc">{selectedItem.documentation}</div>
          ) : null}
          {selectedItem.definitionTarget ? (
            <div className="completion-popup__details-source">
              {`${selectedItem.definitionTarget.path.split(/[\\/]/).at(-1)}:${selectedItem.definitionTarget.line}:${selectedItem.definitionTarget.column}`}
            </div>
          ) : null}
        </aside>
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

function completionDetailsId(itemId: string) {
  return `completion-details-${itemId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
}
