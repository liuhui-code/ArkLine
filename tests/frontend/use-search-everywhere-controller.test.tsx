import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchCandidate } from "@/features/workspace/workspace-index-store";
import type { WorkspaceIndexReadiness } from "@/features/workspace/workspace-index-api-types";
import {
  candidate,
  createDeferred,
  flushSearchDebounce,
  rapidSearchQueries,
  readiness,
  renderSearchHarness,
  workspaceApi,
} from "./search-everywhere-controller-fixtures";

describe("useSearchEverywhereController", () => {
  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("prefills Find in Files from selected editor text", async () => {
    const { result } = renderSearchHarness({ editorSelectedText: "  selected   text  " });

    await act(async () => {
      result.current.search.openSearchOverlay("find");
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.overlay).toBe("searchEverywhere");
    expect(result.current.query).toBe("selected text");
    expect(result.current.search.searchEverywhereMode).toBe("find");
  });

  it("loads Search Everywhere candidates and opens the selected item", async () => {
    vi.useFakeTimers();
    const navigateToLocation = vi.fn(async () => undefined);
    const rememberCurrentLocation = vi.fn();
    const candidates = [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets", line: 8, column: 3 })];
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: candidates,
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderSearchHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
      navigateToLocation,
      rememberCurrentLocation,
    });

    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledWith(
      "/workspace",
      "Entry",
      "all",
      25,
      null,
      { activePath: "/workspace/Entry.ets", recentPaths: [], openedPaths: [] },
    );
    expect(result.current.search.searchEverywhereCandidates).toHaveLength(1);

    await act(async () => {
      await result.current.search.openSelectedSearchEverywhereResult();
    });

    expect(rememberCurrentLocation).toHaveBeenCalledTimes(1);
    expect(navigateToLocation).toHaveBeenCalledWith(
      { path: "/workspace/EntryAbility.ets", line: 8, column: 3 },
      "Usage",
    );
    expect(result.current.overlay).toBe("none");
  });

  it("does not rerun stale backend search while typing before debounce settles", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderSearchHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    act(() => result.current.search.handleOverlayQueryChange("EntryA"));
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(2);
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "/workspace",
      "EntryA",
      "all",
      25,
      null,
      { activePath: "/workspace/Entry.ets", recentPaths: [], openedPaths: [] },
    );
  });

  it("does not query the backend for a single-character search", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderSearchHarness({
      query: "E",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();
    expect(result.current.search.searchEverywhereCandidates).toEqual([]);
  });

  it("invalidates a slow backend search immediately when the query changes", async () => {
    vi.useFakeTimers();
    const slowSearch = createDeferred<{
      items: SearchCandidate[];
      readiness: WorkspaceIndexReadiness;
      explain: string[];
    }>();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(() => slowSearch.promise);
    const { result } = renderSearchHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    act(() => result.current.search.handleOverlayQueryChange("EntryA"));
    await act(async () => {
      slowSearch.resolve({
        items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereCandidates).toEqual([]);
  });

  it("cancels stale backend work while keeping the next query debounced", () => {
    vi.useFakeTimers();
    const cancelWorkspaceSearch = vi.fn(async () => undefined);
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(), explain: [],
    }));
    const { result } = renderSearchHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ cancelWorkspaceSearch, queryWorkspaceCandidatesWithReadiness }),
    });

    act(() => result.current.search.handleOverlayQueryChange("EntryA"));

    expect(cancelWorkspaceSearch).toHaveBeenCalledWith("/workspace", "searchEverywhere", expect.any(Number));
    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalledWith("/workspace", "EntryA", "all", 25);
  });

  it("coalesces rapid typing and deleting into only the latest debounced query", async () => {
    vi.useFakeTimers();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "EntryAbility", path: "/workspace/EntryAbility.ets" })],
      readiness: readiness(),
      explain: [],
    }));
    const { result } = renderSearchHarness({
      query: "",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    act(() => {
      for (const query of rapidSearchQueries("EntryAbility")) {
        result.current.search.handleOverlayQueryChange(query);
      }
    });

    expect(queryWorkspaceCandidatesWithReadiness).not.toHaveBeenCalled();

    await flushSearchDebounce();

    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenLastCalledWith(
      "/workspace",
      "EntryAbility",
      "all",
      25,
      null,
      { activePath: "/workspace/Entry.ets", recentPaths: [], openedPaths: [] },
    );
  });

  it("does not let a slow stale search repopulate results after the query is deleted", async () => {
    vi.useFakeTimers();
    const slowSearch = createDeferred<{
      items: SearchCandidate[];
      readiness: WorkspaceIndexReadiness;
      explain: string[];
    }>();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(() => slowSearch.promise);
    const { result } = renderSearchHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();
    expect(queryWorkspaceCandidatesWithReadiness).toHaveBeenCalledTimes(1);

    act(() => result.current.search.handleOverlayQueryChange(""));
    await flushSearchDebounce();
    expect(result.current.search.searchEverywhereCandidates).toEqual([]);

    await act(async () => {
      slowSearch.resolve({
        items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
        readiness: readiness(),
        explain: [],
      });
      await Promise.resolve();
    });

    expect(result.current.search.searchEverywhereCandidates).toEqual([]);
  });

  it("records search interaction latency when backend candidates resolve", async () => {
    vi.useFakeTimers();
    const recordUiInteraction = vi.fn();
    const queryWorkspaceCandidatesWithReadiness = vi.fn(async () => ({
      items: [candidate({ title: "Entry", path: "/workspace/Entry.ets" })],
      readiness: readiness(),
      explain: [],
    }));

    renderSearchHarness({
      query: "Entry",
      overlay: "searchEverywhere",
      recordUiInteraction,
      workspaceApi: workspaceApi({ queryWorkspaceCandidatesWithReadiness }),
    });

    await flushSearchDebounce();

    expect(recordUiInteraction).toHaveBeenCalledWith("searchEverywhere", "Entry", expect.any(Number), expect.any(Number));
  });

});
