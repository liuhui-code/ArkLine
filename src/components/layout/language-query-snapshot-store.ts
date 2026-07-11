import type { LanguageQuerySnapshot } from "@/components/layout/language-query-request-model";

export type LanguageQuerySnapshotKind = "completion" | "definition" | "usages" | "codeActions";

export type LanguageQuerySnapshotRecordInput = {
  kind: LanguageQuerySnapshotKind;
  snapshot: LanguageQuerySnapshot;
  createdAt?: number;
};

export type LanguageQuerySnapshotRecord = {
  id: string;
  kind: LanguageQuerySnapshotKind;
  path: string;
  line: number;
  column: number;
  contentLength: number;
  contentClass: LanguageQuerySnapshot["meta"]["contentClass"];
  createdAt: number;
};

export function createLanguageQuerySnapshotStore(limit = 20) {
  const records: LanguageQuerySnapshotRecord[] = [];

  return {
    record(input: LanguageQuerySnapshotRecordInput) {
      const createdAt = input.createdAt ?? Date.now();
      const next: LanguageQuerySnapshotRecord = {
        id: `${input.kind}:${createdAt}:${records.length}`,
        kind: input.kind,
        path: input.snapshot.request.path,
        line: input.snapshot.request.line,
        column: input.snapshot.request.column,
        contentLength: input.snapshot.meta.contentLength,
        contentClass: input.snapshot.meta.contentClass,
        createdAt,
      };
      records.unshift(next);
      records.splice(Math.max(limit, 0));
      return next;
    },
    snapshot() {
      return [...records];
    },
    clear() {
      records.splice(0);
    },
  };
}

export const languageQuerySnapshotStore = createLanguageQuerySnapshotStore();
