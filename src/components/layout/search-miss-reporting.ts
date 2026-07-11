import type { SearchEverywhereMode } from "@/components/layout/SearchEverywherePanel";
import {
  searchOverlayLabel,
} from "@/components/layout/search-everywhere-controller-model";
import {
  shouldExplainTextSearchMiss,
} from "@/features/search/search-text-query-session";
import type { WorkspaceTextSearchResult } from "@/features/search/workspace-text-search";
import {
  formatQueryEnvelopeExplain,
} from "@/features/workspace/workspace-query-explain-model";
import type { QueryExplainRecordInput } from "@/features/workspace/workspace-query-explain-store";

type ExplainIndexMiss = (kind: "search", query: string) => Promise<string | null>;

export type SearchEverywhereMissReportInput = {
  requestId: number;
  query: string;
  explain?: string[];
  isCurrentQuery: (requestId: number) => boolean;
  explainIndexMiss: ExplainIndexMiss;
  recordRecentQueryExplain: (entry: QueryExplainRecordInput) => void;
  onStatusChange: (message: string) => void;
};

export type TextSearchMissReportInput = {
  mode: SearchEverywhereMode;
  requestId: number;
  query: string;
  result: WorkspaceTextSearchResult;
  suppressMissExplain: boolean;
  isCurrentQuery: (requestId: number) => boolean;
  explainIndexMiss: ExplainIndexMiss;
  onStatusChange: (message: string) => void;
};

export async function reportSearchEverywhereMiss({
  requestId,
  query,
  explain,
  isCurrentQuery,
  explainIndexMiss,
  recordRecentQueryExplain,
  onStatusChange,
}: SearchEverywhereMissReportInput) {
  const envelopeExplanation = formatQueryEnvelopeExplain(explain);
  if (envelopeExplanation) {
    const message = `Search Everywhere miss: ${envelopeExplanation}`;
    recordRecentQueryExplain({ kind: "search", query: query.trim(), message, explain });
    onStatusChange(message);
    return;
  }
  const explanation = await explainIndexMiss("search", query.trim());
  if (isCurrentQuery(requestId) && explanation) {
    onStatusChange(`Search Everywhere miss: ${explanation}`);
  }
}

export async function reportTextSearchMiss({
  mode,
  requestId,
  query,
  result,
  suppressMissExplain,
  isCurrentQuery,
  explainIndexMiss,
  onStatusChange,
}: TextSearchMissReportInput) {
  if (!shouldExplainTextSearchMiss(result, suppressMissExplain, query)) return;
  const missLabel = searchOverlayLabel(mode);
  const explanation = await explainIndexMiss("search", query.trim());
  if (isCurrentQuery(requestId) && explanation) {
    onStatusChange(`${missLabel} miss: ${explanation}`);
  }
}
