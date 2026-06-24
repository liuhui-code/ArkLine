import type { PropsWithChildren } from "react";
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
    <section className="quick-open" aria-label={`${label} Overlay`}>
      <div className="quick-open__panel">{children}</div>
    </section>
  );
}
