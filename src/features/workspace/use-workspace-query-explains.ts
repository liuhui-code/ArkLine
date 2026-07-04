import { useRef, useState } from "react";
import type { RecentQueryExplain } from "@/features/workspace/workspace-query-explain-model";
import {
  createWorkspaceQueryExplainStore,
  type QueryExplainRecordInput,
} from "@/features/workspace/workspace-query-explain-store";

export function useWorkspaceQueryExplains() {
  const storeRef = useRef(createWorkspaceQueryExplainStore());
  const [recentQueryExplains, setRecentQueryExplains] = useState<RecentQueryExplain[]>(() => [
    ...storeRef.current.state,
  ]);

  function recordRecentQueryExplain(input: QueryExplainRecordInput) {
    const recorded = storeRef.current.record(input);
    if (recorded) {
      setRecentQueryExplains([...storeRef.current.state]);
    }
    return recorded;
  }

  return {
    recentQueryExplains,
    recordRecentQueryExplain,
  };
}
