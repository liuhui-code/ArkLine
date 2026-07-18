import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import {
  AppShellSearchOverlaySurface,
  type AppShellSearchOverlaySurfaceProps,
} from "@/components/layout/AppShellSearchOverlaySurface";
import { createSearchSessionStore } from "@/features/search/search-session-store";

const contentRender = vi.hoisted(() => vi.fn());

vi.mock("@/components/layout/SearchOverlayContent", () => ({
  SearchOverlayContent: (props: { onCloseOverlay: () => void }) => {
    contentRender();
    return <button type="button" onClick={props.onCloseOverlay}>Mock Search Content</button>;
  },
}));

describe("search overlay render boundary", () => {
  it("ignores callback and unrelated result identity changes in search mode", () => {
    contentRender.mockClear();
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const initialProps = createProps(firstClose);
    const { rerender } = render(<AppShellSearchOverlaySurface {...initialProps} />);

    rerender(
      <AppShellSearchOverlaySurface
        {...initialProps}
        onClose={secondClose}
        commandPaletteItems={[]}
        searchOverlayProps={{
          ...initialProps.searchOverlayProps,
          quickOpenResults: [],
          recentFileResults: [],
          recentProjectResults: [],
          onOpenFile: vi.fn(),
        }}
      />,
    );

    expect(contentRender).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Mock Search Content" }));
    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledTimes(1);
  });

  it("rerenders when active search data changes", () => {
    contentRender.mockClear();
    const initialProps = createProps(vi.fn());
    const { rerender } = render(<AppShellSearchOverlaySurface {...initialProps} />);

    rerender(
      <AppShellSearchOverlaySurface
        {...initialProps}
        searchOverlayProps={{
          ...initialProps.searchOverlayProps,
          searchEverywhereOptions: { caseSensitive: true, wholeWord: false },
        }}
      />,
    );

    expect(contentRender).toHaveBeenCalledTimes(2);
  });
});

function createProps(onClose: () => void): AppShellSearchOverlaySurfaceProps {
  return {
    visible: true,
    activeOverlay: "searchEverywhere",
    label: "Search Everywhere",
    onClose,
    commandPaletteItems: [],
    searchOverlayProps: {
      quickOpenQuery: "width",
      quickOpenResults: [],
      recentFileResults: [],
      recentProjectResults: [],
      searchEverywhereOptions: { caseSensitive: false, wholeWord: false },
      searchEverywhereMode: "find",
      searchEverywhereScope: "all",
      searchEverywhereReplaceQuery: "",
      searchSessionStore: createSearchSessionStore(),
      workspacePartialNotice: null,
      onChangeQuery: vi.fn(),
      onDraftQueryChange: vi.fn(),
      onChangeSearchEverywhereScope: vi.fn(),
      onChangeSearchEverywhereReplaceQuery: vi.fn(),
      onOpenFile: vi.fn(),
      onOpenSearchEverywhereResult: vi.fn(),
      onOpenSearchEverywhereCandidate: vi.fn(),
      onLoadNextSearchEverywherePage: vi.fn(),
      onOpenProject: vi.fn(),
      onMoveSearchEverywhereSelection: vi.fn(),
      onOpenSelectedSearchEverywhereResult: vi.fn(),
      onSelectSearchEverywhereResult: vi.fn(),
      onToggleSearchEverywhereCaseSensitive: vi.fn(),
      onToggleSearchEverywhereWholeWord: vi.fn(),
      onSubmitGoToLine: vi.fn(),
    },
  };
}
