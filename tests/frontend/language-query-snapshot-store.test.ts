import { describe, expect, it } from "vitest";
import { buildLanguageQuerySnapshot } from "@/components/layout/language-query-request-model";
import { createLanguageQuerySnapshotStore } from "@/components/layout/language-query-snapshot-store";

describe("language query snapshot store", () => {
  it("records recent language query snapshots newest first", () => {
    const store = createLanguageQuerySnapshotStore(2);

    store.record({ kind: "completion", snapshot: snapshot("/A.ets", "small"), createdAt: 1 });
    store.record({ kind: "definition", snapshot: snapshot("/B.ets", "large"), createdAt: 2 });
    store.record({ kind: "usages", snapshot: snapshot("/C.ets", "small"), createdAt: 3 });

    expect(store.snapshot().map((record) => `${record.kind}:${record.path}`)).toEqual([
      "usages:/C.ets",
      "definition:/B.ets",
    ]);
  });

  it("returns copy-safe snapshots and supports clear", () => {
    const store = createLanguageQuerySnapshotStore();
    store.record({ kind: "codeActions", snapshot: snapshot("/A.ets", "content"), createdAt: 4 });

    store.snapshot().pop();
    expect(store.snapshot()).toHaveLength(1);

    store.clear();
    expect(store.snapshot()).toEqual([]);
  });
});

function snapshot(path: string, content: string) {
  return buildLanguageQuerySnapshot({
    activePath: path,
    editorSelection: { line: 2, column: 3 },
    getActiveContent: () => content,
  });
}
