import type { PropsWithChildren } from "react";
import { PaletteShell } from "@/components/layout/PaletteShell";
import type { OverlayKey } from "@/components/layout/shell-state";

type OverlaySurfaceProps = PropsWithChildren<{
  activeOverlay: OverlayKey;
  label: string;
  onClose?: () => void;
}>;

export function OverlaySurface({
  activeOverlay,
  label,
  onClose,
  children
}: OverlaySurfaceProps) {
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
        <div className="quick-open__panel quick-open__panel--search-everywhere" onMouseDown={(event) => event.stopPropagation()}>
          {children}
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
