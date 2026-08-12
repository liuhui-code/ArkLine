import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  AppShellSearchOverlaySurface,
  type AppShellSearchOverlaySurfaceProps,
} from "@/components/layout/AppShellSearchOverlaySurface";

describe("search overlay render boundary", () => {
  it("uses the latest close callback without recreating an unrelated search session", () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const initialProps = createProps(firstClose);
    const { rerender } = render(<AppShellSearchOverlaySurface {...initialProps} />);

    rerender(
      <AppShellSearchOverlaySurface
        {...initialProps}
        onClose={secondClose}
        searchOverlayProps={{
          ...initialProps.searchOverlayProps,
          recentFileResults: [{ path: "/workspace/Entry.ets", title: "Entry.ets", relativePath: "src/Entry.ets" }],
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Entry.ets src/Entry.ets" }));
    expect(initialProps.searchOverlayProps.onOpenFile).toHaveBeenCalledWith("/workspace/Entry.ets");
    fireEvent.click(screen.getByRole("button", { name: "Close Recent Files" }));
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("renders only non-search overlays after Search Everywhere moved to its own controller", () => {
    const initialProps = createProps(vi.fn());
    render(<AppShellSearchOverlaySurface {...initialProps} />);
    expect(screen.getByRole("textbox", { name: "Recent Files Query" })).toBeVisible();
  });
});

function createProps(onClose: () => void): AppShellSearchOverlaySurfaceProps {
  return {
    visible: true,
    activeOverlay: "recentFiles",
    label: "Recent Files",
    onClose,
    commandPaletteItems: [],
    searchOverlayProps: {
      query: "",
      recentFileResults: [],
      recentProjectResults: [],
      onChangeQuery: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenProject: vi.fn(),
      onSubmitGoToLine: vi.fn(),
    },
  };
}
