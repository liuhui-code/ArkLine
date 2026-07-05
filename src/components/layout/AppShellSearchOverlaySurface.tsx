import type { ComponentProps } from "react";
import { OverlaySurface } from "@/components/layout/OverlaySurface";
import { SearchOverlayContent } from "@/components/layout/SearchOverlayContent";
import type { OverlayKey } from "@/components/layout/shell-state";
import type { CommandPaletteItem } from "@/components/layout/search-overlay-model";

export type AppShellSearchOverlaySurfaceProps = {
  visible: boolean;
  activeOverlay: OverlayKey;
  label: string;
  onClose: () => void;
  commandPaletteItems: CommandPaletteItem[];
  searchOverlayProps: Omit<
    ComponentProps<typeof SearchOverlayContent>,
    "activeOverlay" | "commandPaletteItems" | "onCloseOverlay"
  >;
};

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
    <OverlaySurface
      activeOverlay={activeOverlay}
      label={label}
      onClose={onClose}
      searchMode={searchOverlayProps.searchEverywhereMode}
    >
      <SearchOverlayContent
        activeOverlay={activeOverlay}
        commandPaletteItems={commandPaletteItems}
        onCloseOverlay={onClose}
        {...searchOverlayProps}
      />
    </OverlaySurface>
  );
}
