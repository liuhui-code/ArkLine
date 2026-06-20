import type { PropsWithChildren } from "react";
import type { OverlayKey } from "@/components/layout/shell-state";

type OverlaySurfaceProps = PropsWithChildren<{
  activeOverlay: OverlayKey;
  label: string;
}>;

export function OverlaySurface({
  activeOverlay,
  label,
  children
}: OverlaySurfaceProps) {
  if (activeOverlay === "none") {
    return null;
  }

  return (
    <section className="quick-open" aria-label={`${label} Overlay`}>
      <div className="quick-open__panel">{children}</div>
    </section>
  );
}
