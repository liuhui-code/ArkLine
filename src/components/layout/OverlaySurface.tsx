import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PropsWithChildren } from "react";
import { PaletteShell } from "@/components/layout/PaletteShell";
import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import type { OverlayKey } from "@/components/layout/shell-state";

type OverlaySurfaceProps = PropsWithChildren<{
  activeOverlay: OverlayKey;
  label: string;
  onClose?: () => void;
  searchMode?: SearchEverywhereMode;
}>;

type PanelSize = {
  width: number;
  height: number;
};

const DEFAULT_SEARCH_PANEL_SIZE: Record<SearchEverywhereMode, PanelSize> = {
  searchEverywhere: { width: 760, height: 420 },
  find: { width: 860, height: 540 },
  replace: { width: 860, height: 560 },
};

const MIN_SEARCH_PANEL_SIZE: PanelSize = { width: 560, height: 320 };

export function OverlaySurface({
  activeOverlay,
  label,
  onClose,
  searchMode = "searchEverywhere",
  children
}: OverlaySurfaceProps) {
  const resizeStartRef = useRef<{ x: number; y: number; size: PanelSize } | null>(null);
  const [panelSize, setPanelSize] = useState<PanelSize | null>(null);
  const defaultPanelSize = DEFAULT_SEARCH_PANEL_SIZE[searchMode];
  const resolvedPanelSize = clampSearchPanelSize(panelSize ?? defaultPanelSize);
  const panelStyle = {
    "--search-everywhere-panel-width": `${resolvedPanelSize.width}px`,
    "--search-everywhere-panel-height": `${resolvedPanelSize.height}px`,
  } as CSSProperties;

  useEffect(() => {
    setPanelSize(null);
  }, [activeOverlay, searchMode]);

  useEffect(() => {
    function finishResize() {
      resizeStartRef.current = null;
      document.body.style.userSelect = "";
    }

    function handleMouseMove(event: MouseEvent) {
      const start = resizeStartRef.current;
      if (!start) {
        return;
      }

      const point = readMousePoint(event);
      if (!point) {
        return;
      }

      setPanelSize(clampSearchPanelSize({
        width: start.size.width + point.x - start.x,
        height: start.size.height + point.y - start.y,
      }));
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishResize);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishResize);
      finishResize();
    };
  }, []);

  function startResize(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    const point = readMousePoint(event.nativeEvent);
    if (!point) {
      return;
    }

    resizeStartRef.current = { x: point.x, y: point.y, size: resolvedPanelSize };
    document.body.style.userSelect = "none";
  }

  if (activeOverlay === "none") {
    return null;
  }

  if (activeOverlay === "searchEverywhere") {
    return (
      <section
        className="quick-open quick-open--search-everywhere"
        aria-label={`${label} Overlay`}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            onClose?.();
          }
        }}
      >
        <div
          className={`quick-open__panel quick-open__panel--search-everywhere quick-open__panel--search-${searchMode}`}
          aria-label={`${label} Panel`}
          style={panelStyle}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {children}
          <button
            type="button"
            className="quick-open__resize-handle"
            aria-label={`Resize ${label} Panel`}
            onMouseDown={startResize}
          />
        </div>
      </section>
    );
  }

  return (
    <PaletteShell label={label} description={paletteDescription(activeOverlay)} onClose={onClose}>
      {children}
    </PaletteShell>
  );
}

function paletteDescription(activeOverlay: OverlayKey) {
  if (activeOverlay === "commandPalette") {
    return "Find commands and actions";
  }

  if (activeOverlay === "quickOpen") {
    return "Open files by name or path";
  }

  if (activeOverlay === "recentFiles") {
    return "Return to recently opened files";
  }

  if (activeOverlay === "recentProjects") {
    return "Open a recent workspace";
  }

  if (activeOverlay === "goToLine") {
    return "Jump to a line or column in the active editor";
  }

  return "Temporary workbench palette";
}

function clampSearchPanelSize(size: PanelSize): PanelSize {
  const maxWidth = Math.max(MIN_SEARCH_PANEL_SIZE.width, (window.innerWidth || 1024) - 48);
  const maxHeight = Math.max(MIN_SEARCH_PANEL_SIZE.height, (window.innerHeight || 768) - 80);
  return {
    width: Math.min(Math.max(size.width, MIN_SEARCH_PANEL_SIZE.width), maxWidth),
    height: Math.min(Math.max(size.height, MIN_SEARCH_PANEL_SIZE.height), maxHeight),
  };
}

function readMousePoint(event: MouseEvent): { x: number; y: number } | null {
  const x = Number.isFinite(event.clientX) ? event.clientX : event.pageX;
  const y = Number.isFinite(event.clientY) ? event.clientY : event.pageY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}
