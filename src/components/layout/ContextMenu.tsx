import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect: () => void;
};

export type ContextMenuState = {
  label: string;
  x: number;
  y: number;
  items: ContextMenuItem[];
};

type ContextMenuProps = {
  state: ContextMenuState | null;
  onClose: () => void;
};

const MENU_WIDTH = 236;
const MENU_MARGIN = 8;
const MENU_ROW_HEIGHT = 30;

function constrainPosition(x: number, y: number, itemCount: number) {
  if (typeof window === "undefined") {
    return { left: x, top: y };
  }

  const estimatedHeight = itemCount * MENU_ROW_HEIGHT + 12;
  return {
    left: Math.min(Math.max(MENU_MARGIN, x), Math.max(MENU_MARGIN, window.innerWidth - MENU_WIDTH - MENU_MARGIN)),
    top: Math.min(Math.max(MENU_MARGIN, y), Math.max(MENU_MARGIN, window.innerHeight - estimatedHeight - MENU_MARGIN)),
  };
}

export function ContextMenu({ state, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabledItems = useMemo(() => state?.items.filter((item) => !item.disabled) ?? [], [state]);
  const position = state ? constrainPosition(state.x, state.y, state.items.length) : null;

  useEffect(() => {
    if (!state) {
      return;
    }

    const firstItem = enabledItems[0];
    if (firstItem) {
      window.requestAnimationFrame(() => itemRefs.current.get(firstItem.id)?.focus());
    }

    function handlePointerDown(event: PointerEvent | MouseEvent) {
      if (menuRef.current?.contains(event.target as Node)) {
        return;
      }
      onClose();
    }

    function handleWindowBlur() {
      onClose();
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("blur", handleWindowBlur);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("blur", handleWindowBlur);
      window.removeEventListener("resize", onClose);
    };
  }, [enabledItems, onClose, state]);

  if (!state || !position) {
    return null;
  }

  function focusItem(offset: number) {
    const currentIndex = enabledItems.findIndex((item) => itemRefs.current.get(item.id) === document.activeElement);
    const nextIndex = currentIndex === -1 ? 0 : (currentIndex + offset + enabledItems.length) % enabledItems.length;
    const nextItem = enabledItems[nextIndex];
    if (nextItem) {
      itemRefs.current.get(nextItem.id)?.focus();
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusItem(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusItem(-1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      itemRefs.current.get(enabledItems[0]?.id ?? "")?.focus();
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      itemRefs.current.get(enabledItems.at(-1)?.id ?? "")?.focus();
    }
  }

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label={state.label}
      style={{ left: `${position.left}px`, top: `${position.top}px` }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
    >
      {state.items.map((item) => (
        <div key={item.id} className={item.separatorBefore ? "context-menu__group context-menu__group--separated" : "context-menu__group"}>
          <button
            ref={(node) => {
              if (node) {
                itemRefs.current.set(item.id, node);
              } else {
                itemRefs.current.delete(item.id);
              }
            }}
            type="button"
            className="context-menu__item"
            role="menuitem"
            aria-label={item.label}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) {
                return;
              }
              item.onSelect();
              onClose();
            }}
          >
            <span className="context-menu__label">{item.label}</span>
            {item.shortcut ? <span className="context-menu__shortcut">{item.shortcut}</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
