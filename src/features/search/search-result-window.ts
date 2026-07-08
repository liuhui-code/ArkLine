export type SearchResultWindowItem<T> = {
  item: T;
  index: number;
};

export type SearchResultWindow<T> = {
  items: SearchResultWindowItem<T>[];
  start: number;
  end: number;
  total: number;
};

export function createSearchResultWindow<T>(
  items: T[],
  selectedIndex: number,
  radius = 40,
): SearchResultWindow<T> {
  const total = items.length;
  if (total === 0) {
    return { items: [], start: 0, end: 0, total };
  }

  const selected = Math.min(Math.max(selectedIndex, 0), total - 1);
  const start = Math.max(0, selected - radius);
  const end = Math.min(total, selected + radius + 1);
  return {
    items: items.slice(start, end).map((item, offset) => ({ item, index: start + offset })),
    start,
    end,
    total,
  };
}
