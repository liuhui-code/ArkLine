import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  flushPreviewDebounce,
  flushSearchDebounce,
  renderSearchHarness,
  workspaceApi,
} from "./search-everywhere-controller-fixtures";

describe("useSearchEverywhereController text search", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("notifies the backend to cancel text search when the overlay resets", () => {
    vi.useFakeTimers();
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const { result } = renderSearchHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ cancelWorkspaceSearch }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    act(() => result.current.search.resetSearchOverlayState());

    expect(cancelWorkspaceSearch).toHaveBeenLastCalledWith(
      "/workspace",
      "text",
      expect.any(Number),
    );
  });

  it("runs text search and loads selected file preview content", async () => {
    vi.useFakeTimers();
    const { result } = renderSearchHarness({
      query: "width",
      overlay: "searchEverywhere",
      editorContent: "struct Entry {\n  width(100)\n}",
      workspaceApi: workspaceApi({
        openFile: vi.fn(async () => "struct Entry {\n  width(100)\n}"),
      }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    await flushPreviewDebounce();

    expect(result.current.search.searchEverywhereResult.matches).toHaveLength(1);
    expect(result.current.search.searchEverywherePreviewContent).toBe("struct Entry {\n  width(100)\n}");
  });

  it("passes a text search generation to backend workspace search", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
    }));
    const { result } = renderSearchHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();

    expect(searchWorkspaceText).toHaveBeenCalledWith(expect.objectContaining({
      generation: expect.any(Number),
      query: "width",
    }));
  });

  it("shows partial text search status from backend results", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
      partial: true,
      searchedFiles: 12,
      prefilterSkippedFiles: 40,
      limitReached: true,
    }));
    const { result } = renderSearchHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();

    expect(result.current.search.searchEverywhereTruncationNotice).toContain("scanning 12 file");
    expect(result.current.search.searchEverywhereTruncationNotice).toContain("skipped 40 prefiltered file");
  });

  it("does not call native text search after the Find query is deleted", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {}, configurable: true });
    const searchWorkspaceText = vi.fn(async () => ({
      query: { kind: "text" as const, query: "width" },
      matches: [],
    }));
    const { result } = renderSearchHarness({
      query: "width",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ searchWorkspaceText }),
    });

    act(() => result.current.search.openSearchOverlay("find"));
    await flushSearchDebounce();
    const callsBeforeDelete = searchWorkspaceText.mock.calls.length;
    expect(callsBeforeDelete).toBeGreaterThan(0);

    act(() => result.current.search.handleOverlayQueryChange(""));
    await flushSearchDebounce();

    expect(searchWorkspaceText).toHaveBeenCalledTimes(callsBeforeDelete);
    expect(result.current.search.searchEverywhereResult.matches).toEqual([]);
  });
});
