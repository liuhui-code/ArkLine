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
    return <div aria-label="Usages Panel">{state.message ?? "No usages found"}</div>;
  }

  if (state.items.length === 0) {
    return <div aria-label="Usages Panel">Run Find Usages to inspect symbol references.</div>;
  }

  const groups = groupUsagesByPath(state.items);

  return (
    <div className="search-results search-results--grouped usages-panel__results" aria-label="Usages Panel">
      {groups.map((group) => (
        <section
          key={group.path}
          className="search-result-group"
          role="group"
          aria-label={`${fileName(group.path)} ${group.items.length} ${group.items.length === 1 ? "usage" : "usages"}`}
        >
          <div className="search-result-group__header">
            <div>
              <span className="search-result-group__file">{fileName(group.path)}</span>
              <span className="search-result-group__path">{group.path}</span>
            </div>
            <span className="search-result-group__count">{group.items.length}</span>
          </div>
          <div className="search-result-group__matches">
            {group.items.map((item) => (
              <button
                key={`${item.path}:${item.line}:${item.column}`}
                type="button"
                aria-label={`${item.path} ${item.line}:${item.column} ${item.preview} ${item.kind} ${item.confidence}`}
                className="search-result search-result--match usages-panel__item"
                onClick={() => onOpenUsage(item)}
              >
                <span className="search-result__location">{item.line}:{item.column}</span>
                <span className="search-result__preview">{item.preview}</span>
                <span className="search-result__meta usages-panel__meta">
                  <span>{item.kind}</span>
                  <span>{item.confidence}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type UsageGroup = {
  path: string;
  items: UsageResult[];
};

function groupUsagesByPath(items: UsageResult[]): UsageGroup[] {
  const groups = new Map<string, UsageResult[]>();
  for (const item of items) {
    const group = groups.get(item.path);
    if (group) {
      group.push(item);
    } else {
      groups.set(item.path, [item]);
    }
  }
  return Array.from(groups, ([path, groupItems]) => ({ path, items: groupItems }));
}

function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
