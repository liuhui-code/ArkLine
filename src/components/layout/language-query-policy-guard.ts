import type { LanguageQuerySnapshot } from "@/components/layout/language-query-request-model";

export type LanguageQuerySyncDecision = {
  allowSyncRequest: boolean;
  severity: "ok" | "caution" | "blocked";
  label: string;
  reason: string;
};

export function decideLanguageQuerySync(snapshot: LanguageQuerySnapshot): LanguageQuerySyncDecision {
  if (snapshot.meta.contentClass === "oversized") {
    return {
      allowSyncRequest: false,
      severity: "blocked",
      label: "Avoid sync",
      reason: "Content snapshot is oversized; prefer indexed or worker-backed query paths.",
    };
  }
  if (snapshot.meta.contentClass === "large") {
    return {
      allowSyncRequest: true,
      severity: "caution",
      label: "Sync cautious",
      reason: "Content snapshot is large; prefer indexed answers when available.",
    };
  }
  return {
    allowSyncRequest: true,
    severity: "ok",
    label: "Sync OK",
    reason: "Content snapshot is within the synchronous request budget.",
  };
}
