import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { SearchEverywherePanel } from "@/components/layout/SearchEverywherePanel";

const candidateRenderCount = vi.hoisted(() => ({
  value: 0,
  byId: new Map<string, number>(),
}));

vi.mock("@/components/layout/SearchResultItems", async () => {
  const { memo } = await import("react");
  const SearchCandidateResultItem = memo((props: {
    item: { id: string; title: string };
    selected: boolean;
  }) => {
    candidateRenderCount.value += 1;
    candidateRenderCount.byId.set(
      props.item.id,
      (candidateRenderCount.byId.get(props.item.id) ?? 0) + 1,
    );
    return <button type="button" aria-selected={props.selected}>{props.item.title}</button>;
  });
  return {
    SearchCandidateResultItem,
    TextSearchResultItem: () => <button type="button">text result</button>,
  };
});

describe("Search Everywhere render isolation", () => {
  it("does not rerender result rows while the user edits the local query draft", () => {
    vi.useFakeTimers();
    candidateRenderCount.value = 0;
    candidateRenderCount.byId.clear();
    render(
      <SearchEverywherePanel
        mode="searchEverywhere"
        scope="all"
        options={{ caseSensitive: false, wholeWord: false }}
        query="Entry"
        replaceQuery=""
        result={{ query: { kind: "text", query: "Entry" }, matches: [] }}
        candidates={[{
          id: "EntryAbility",
          source: "class",
          kind: "class",
          title: "EntryAbility",
          subtitle: "EntryAbility.ets",
          path: "/workspace/EntryAbility.ets",
          score: 1,
          freshness: "ready",
        }]}
        selectedIndex={0}
        selectedPreviewContent={null}
        canLoadMore={false}
        pageLoading={false}
        onChangeQuery={vi.fn()}
        onDraftQueryChange={vi.fn()}
        onChangeScope={vi.fn()}
        onChangeReplaceQuery={vi.fn()}
        onMoveSelection={vi.fn()}
        onOpenSelected={vi.fn()}
        onSelectResult={vi.fn()}
        onOpenResult={vi.fn()}
        onOpenCandidate={vi.fn()}
        onLoadMore={vi.fn()}
        onToggleCaseSensitive={vi.fn()}
        onToggleWholeWord={vi.fn()}
        onCloseOverlay={vi.fn()}
      />,
    );
    const input = screen.getByLabelText("Search Everywhere Query");
    expect(candidateRenderCount.value).toBe(1);

    for (let index = 0; index < 100; index += 1) {
      fireEvent.change(input, { target: { value: `Entry${index}` } });
    }

    expect(input).toHaveValue("Entry99");
    expect(candidateRenderCount.value).toBe(1);
    vi.useRealTimers();
  });

  it("rerenders only the previous and next rows when selection moves", () => {
    candidateRenderCount.value = 0;
    candidateRenderCount.byId.clear();
    const candidates = ["A", "B", "C"].map((id) => ({
      id,
      source: "class" as const,
      kind: "class",
      title: id,
      subtitle: `${id}.ets`,
      path: `/workspace/${id}.ets`,
      score: 1,
      freshness: "ready" as const,
    }));
    const props = createPanelProps(candidates);
    const { rerender } = render(
      <SearchEverywherePanel {...props} selectedIndex={0} />,
    );

    rerender(<SearchEverywherePanel {...props} selectedIndex={1} />);

    expect(candidateRenderCount.value).toBe(5);
    expect(candidateRenderCount.byId.get("A")).toBe(2);
    expect(candidateRenderCount.byId.get("B")).toBe(2);
    expect(candidateRenderCount.byId.get("C")).toBe(1);
  });
});

function createPanelProps(candidates: Parameters<typeof SearchEverywherePanel>[0]["candidates"]) {
  return {
    mode: "searchEverywhere" as const,
    scope: "all" as const,
    options: { caseSensitive: false, wholeWord: false },
    query: "Entry",
    replaceQuery: "",
    result: { query: { kind: "text" as const, query: "Entry" }, matches: [] },
    candidates,
    selectedPreviewContent: null,
    canLoadMore: false,
    pageLoading: false,
    onChangeQuery: vi.fn(),
    onDraftQueryChange: vi.fn(),
    onChangeScope: vi.fn(),
    onChangeReplaceQuery: vi.fn(),
    onMoveSelection: vi.fn(),
    onOpenSelected: vi.fn(),
    onSelectResult: vi.fn(),
    onOpenResult: vi.fn(),
    onOpenCandidate: vi.fn(),
    onLoadMore: vi.fn(),
    onToggleCaseSensitive: vi.fn(),
    onToggleWholeWord: vi.fn(),
    onCloseOverlay: vi.fn(),
  };
}
