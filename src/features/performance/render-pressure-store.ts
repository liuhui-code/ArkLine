export type RenderPressureSample = {
  label: string;
  count: number;
  lastRenderedAt: number;
};

export function createRenderPressureStore(limit = 40) {
  const samples = new Map<string, RenderPressureSample>();

  return {
    record(label: string, now = Date.now()) {
      const current = samples.get(label);
      samples.set(label, {
        label,
        count: (current?.count ?? 0) + 1,
        lastRenderedAt: now,
      });
      while (samples.size > limit) {
        const firstKey = samples.keys().next().value;
        if (!firstKey) {
          break;
        }
        samples.delete(firstKey);
      }
    },
    snapshot() {
      return [...samples.values()].sort((left, right) => right.lastRenderedAt - left.lastRenderedAt);
    },
  };
}
