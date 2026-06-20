import type { UsageResult, UsageSearchState } from "@/features/workspace/usage-search";

type UsagesPanelProps = {
  state: UsageSearchState;
  onOpenUsage: (item: UsageResult) => void;
};

export function UsagesPanel({ state, onOpenUsage }: UsagesPanelProps) {
  if (state.status === "loading") {
    return <div aria-label="Usages Panel">Finding usages...</div>;
  }

  if (state.status === "error") {
    return <div aria-label="Usages Panel">{state.message ?? "Usage query failed"}</div>;
  }

  if (state.status === "empty") {
    return <div aria-label="Usages Panel">No usages found</div>;
  }

  if (state.items.length === 0) {
    return <div aria-label="Usages Panel">Run Find Usages to inspect symbol references.</div>;
  }

  return (
    <div aria-label="Usages Panel">
      {state.items.map((item) => (
        <button
          key={`${item.path}:${item.line}:${item.column}`}
          type="button"
          className="search-result"
          onClick={() => onOpenUsage(item)}
        >
          {item.path}
          <span className="search-result__meta">
            {item.line}:{item.column} {item.preview}
          </span>
        </button>
      ))}
    </div>
  );
}
