import type { KeyboardEvent } from "react";
import { PaletteShell } from "@/components/layout/PaletteShell";
import { englishQueryInputProps } from "@/components/layout/query-input-props";
import type { CurrentClassMethod } from "@/features/workspace/current-class-methods";

type CurrentClassMethodsPaletteProps = {
  query: string;
  methods: CurrentClassMethod[];
  selectedIndex: number;
  onChangeQuery: (query: string) => void;
  onClose: () => void;
  onOpenMethod: (method: CurrentClassMethod) => void;
  onSelectIndex: (index: number) => void;
};

export function CurrentClassMethodsPalette({
  query,
  methods,
  selectedIndex,
  onChangeQuery,
  onClose,
  onOpenMethod,
  onSelectIndex,
}: CurrentClassMethodsPaletteProps) {
  const selectedMethod = methods[Math.min(selectedIndex, Math.max(methods.length - 1, 0))] ?? null;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (methods.length === 0) {
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      onSelectIndex((selectedIndex + direction + methods.length) % methods.length);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      if (selectedMethod) {
        onOpenMethod(selectedMethod);
      }
    }
  }

  return (
    <PaletteShell label="File Structure" description="Ctrl+F12" onClose={onClose}>
      <div className="current-methods-palette">
        <input
          aria-label="File Structure Query"
          autoFocus
          className="search-overlay__input"
          {...englishQueryInputProps}
          placeholder="Search methods and members"
          value={query}
          onChange={(event) => onChangeQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="current-methods-palette__results" role="listbox" aria-label="File Structure Results">
          {methods.map((method, index) => (
            <button
              key={`${method.line}:${method.column}:${method.signature}`}
              type="button"
              role="option"
              aria-selected={index === selectedIndex}
              className={`current-methods-palette__item${index === selectedIndex ? " current-methods-palette__item--selected" : ""}`}
              onMouseEnter={() => onSelectIndex(index)}
              onClick={() => onOpenMethod(method)}
            >
              <span className="current-methods-palette__signature">{method.signature}</span>
              <span className="current-methods-palette__line">line {method.line}</span>
            </button>
          ))}
          {methods.length === 0 ? <div className="current-methods-palette__empty">No methods or members found in the current file.</div> : null}
        </div>
      </div>
    </PaletteShell>
  );
}
