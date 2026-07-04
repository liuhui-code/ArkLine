import type { RecentQueryExplain } from "@/features/workspace/workspace-query-explain-model";

export type QueryExplainRecordInput = {
  kind: RecentQueryExplain["kind"];
  query: string;
  message: string;
  explain?: string[];
};

export type WorkspaceQueryExplainStore = {
  readonly state: RecentQueryExplain[];
  record(input: QueryExplainRecordInput): boolean;
  clear(): void;
};

export function createWorkspaceQueryExplainStore(limit = 5): WorkspaceQueryExplainStore {
  const state: RecentQueryExplain[] = [];

  return {
    get state() {
      return state;
    },
    record(input) {
      if (!input.explain?.length) {
        return false;
      }
      const timestamp = Date.now();
      state.unshift({
        id: `${input.kind}:${timestamp}:${state.length}`,
        kind: input.kind,
        query: input.query,
        message: input.message,
        explain: input.explain,
        createdAt: timestamp,
      });
      state.splice(Math.max(limit, 0));
      return true;
    },
    clear() {
      state.splice(0);
    },
  };
}
