import { memo } from "react";
import { NonSearchOverlayContent, type NonSearchOverlayContentProps } from "@/components/layout/NonSearchOverlayContent";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";

export type AppShellSearchOverlaySurfaceProps = {
  visible: boolean;
  activeOverlay: OverlayKey;
  label: string;
  onClose: () => void;
  commandPaletteItems: CommandPaletteItem[];
  searchOverlayProps: Omit<NonSearchOverlayContentProps, "activeOverlay" | "label" | "commandPaletteItems" | "onClose">;
};

const MemoNonSearchOverlayContent = memo(NonSearchOverlayContent);

export function AppShellSearchOverlaySurface({
  visible,
  activeOverlay,
  label,
  onClose,
  commandPaletteItems,
  searchOverlayProps,
}: AppShellSearchOverlaySurfaceProps) {
  if (!visible) {
    return null;
  }

  return (
    <MemoNonSearchOverlayContent
        {...searchOverlayProps}
        activeOverlay={activeOverlay}
        label={label}
        commandPaletteItems={commandPaletteItems}
        onClose={onClose}
      />
  );
}
