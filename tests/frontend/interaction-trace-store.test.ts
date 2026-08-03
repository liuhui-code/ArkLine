import { createInteractionTraceStore } from "@/features/performance/interaction-trace-store";

describe("interaction trace store", () => {
  it("records a versioned interaction as ordered phase timings", () => {
    let now = 1_000;
    const store = createInteractionTraceStore(10, () => now);
    const trace = store.begin("quickOpen", "Entry", 7);
    const debounce = trace.startPhase("debounce");
    now = 1_040;
    debounce.finish();
    const query = trace.startPhase("queryBroker");
    now = 1_095;
    query.finish();
    trace.finish();

    expect(store.getSnapshot()).toEqual([{
      id: "1000:1",
      kind: "quickOpen",
      label: "Entry",
      generation: 7,
      startedAt: 1_000,
      durationMs: 95,
      status: "ok",
      phases: [
        { name: "debounce", startedAt: 1_000, durationMs: 40, status: "ok" },
        { name: "queryBroker", startedAt: 1_040, durationMs: 55, status: "ok" },
      ],
    }]);
  });

  it("retains a bounded immutable snapshot", () => {
    let now = 10;
    const store = createInteractionTraceStore(2, () => now);
    store.begin("openFile", "A").finish();
    now += 1;
    const previous = store.getSnapshot();
    store.begin("openFile", "B").finish();
    now += 1;
    store.begin("openFile", "C").finish();

    expect(store.getSnapshot().map((trace) => trace.label)).toEqual(["B", "C"]);
    expect(previous.map((trace) => trace.label)).toEqual(["A"]);
  });

  it("links child work to one causal interaction and exposes phase detail", () => {
    let now = 2_000;
    const store = createInteractionTraceStore(10, () => now);
    const parent = store.begin("navigation", "Target.ets", 9);
    const child = store.begin("openFile", "Target.ets", 9, {
      parentId: parent.id,
      attributes: { path: "/workspace/Target.ets", source: "definition" },
    });
    const read = child.startPhase("fileRead");
    now = 2_024;
    read.finish("ok", "cache=miss");
    child.finish();
    parent.finish();

    expect(store.getSnapshot()[1]).toMatchObject({
      parentId: parent.id,
      attributes: { path: "/workspace/Target.ets", source: "definition" },
      phases: [{ name: "fileRead", durationMs: 24, detail: "cache=miss" }],
    });
  });

  it("mirrors immutable trace evidence without requiring a React subscriber", () => {
    const evidence: unknown[][] = [];
    const store = createInteractionTraceStore(10, Date.now, (snapshot) => {
      evidence.push(snapshot);
    });

    store.begin("editorInput", "Main.ets").finish();

    expect(evidence.at(-1)).toEqual(store.getSnapshot());
    expect(evidence.at(-1)).not.toBe(store.getSnapshot());
  });
});
