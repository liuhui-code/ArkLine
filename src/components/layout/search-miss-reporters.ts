import type {
  EntitySearchRequestRunnerInput,
  TextSearchRequestRunnerInput,
} from "@/components/layout/search-request-runner";
import {
  reportSearchEverywhereMiss,
  reportTextSearchMiss,
} from "@/components/layout/search-miss-reporting";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";

export type SearchMissReportersInput = {
  isCurrentQuery: (requestId: number) => boolean;
  explainIndexMiss: (kind: "search", query: string) => Promise<string | null>;
  recordRecentQueryExplain: (entry: QueryExplainRecordInput) => void;
  onStatusChange: (message: string) => void;
};

export type SearchMissReporters = {
  reportEntityMiss: EntitySearchRequestRunnerInput["reportMiss"];
  reportTextMiss: TextSearchRequestRunnerInput["reportMiss"];
};

export function createSearchMissReporters({
  isCurrentQuery,
  explainIndexMiss,
  recordRecentQueryExplain,
  onStatusChange,
}: SearchMissReportersInput): SearchMissReporters {
  return {
    reportEntityMiss: (requestId, missReport) => {
      void reportSearchEverywhereMiss({
        requestId,
        query: missReport.query,
        explain: missReport.explain,
        isCurrentQuery,
        explainIndexMiss,
        recordRecentQueryExplain,
        onStatusChange,
      });
    },
    reportTextMiss: (requestId, missReport) => {
      void reportTextSearchMiss({
        requestId,
        ...missReport,
        isCurrentQuery,
        explainIndexMiss,
        onStatusChange,
      });
    },
  };
}
