import type { WorkspaceIndexEvent } from "@/features/workspace/workspace-index-api-types";

export type RecentQueryExplain = {
  id: string;
  kind: "search" | "definition" | "usages" | "completion";
  query: string;
  message: string;
  explain: string[];
  createdAt: number;
};

export type QueryEnvelopeExplainSummary = {
  actionId: string | null;
  action: string | null;
  used: string | null;
  skipped: string | null;
  readiness: string | null;
  resultCount: string | null;
  generation: string | null;
  retryable: string | null;
  searchMetrics: string | null;
};

export type QueryExplainTimelineItem = {
  id: string;
  source: "frontend" | "backend";
  severity: string;
  title: string;
  message: string;
  summary: QueryEnvelopeExplainSummary | null;
  raw: string;
  createdAt: number;
  displayTime: string;
};

export function formatQueryEnvelopeExplain(explain?: string[]) {
  if (!explain?.length) return null;

  const reason = findExplainValue(explain, "reason");
  if (reason) return reason;

  const action = findExplainValue(explain, "action");
  const actionMessage = formatExplainAction(action);
  if (actionMessage) return actionMessage;

  const readiness = findExplainValue(explain, "readiness");
  const resultCount = findExplainValue(explain, "resultCount");
  if (readiness && readiness !== "Ready") {
    return `Index readiness is ${readiness.toLowerCase()}`;
  }
  if (resultCount === "0") {
    return "Indexed query returned no results";
  }
  return null;
}

export function summarizeQueryEnvelopeExplain(explain?: string[]): QueryEnvelopeExplainSummary | null {
  if (!explain?.length) return null;
  const actionId = findExplainValue(explain, "action") ?? null;

  const summary = {
    actionId,
    action: formatExplainActionLabel(actionId ?? undefined),
    used: formatExplainList(findExplainValue(explain, "used")),
    skipped: formatSkippedExplain(findExplainValue(explain, "skipped")),
    readiness: findExplainValue(explain, "readiness") ?? null,
    resultCount: findExplainValue(explain, "resultCount") ?? null,
    generation: formatGeneration(
      findExplainValue(explain, "servedGeneration"),
      findExplainValue(explain, "requestedGeneration"),
    ),
    retryable: formatBoolean(findExplainValue(explain, "retryable")),
    searchMetrics: formatSearchMetrics(
      findExplainValue(explain, "searchedFiles"),
      findExplainValue(explain, "prefilterSkippedFiles"),
      findExplainValue(explain, "limitReached"),
    ),
  };

  return Object.values(summary).some(Boolean) ? summary : null;
}

export function summarizeQueryEventPayload(payloadJson?: string): QueryEnvelopeExplainSummary | null {
  if (!payloadJson) return null;
  try {
    const payload = JSON.parse(payloadJson) as { explain?: unknown; recommendedAction?: unknown };
    const recommendedAction = typeof payload.recommendedAction === "string" ? payload.recommendedAction : null;
    if (!Array.isArray(payload.explain)) {
      return recommendedAction ? emptyActionSummary(recommendedAction) : null;
    }
    const explain = payload.explain.filter((item): item is string => typeof item === "string");
    const summary = summarizeQueryEnvelopeExplain(explain);
    if (!summary || summary.actionId || !recommendedAction) {
      return summary;
    }
    return {
      ...summary,
      actionId: recommendedAction,
      action: formatExplainActionLabel(recommendedAction),
    };
  } catch {
    return null;
  }
}

export function getQueryExplainActionButtonLabel(actionId: string | null) {
  if (actionId === "waitForIndex") return "Show Processes";
  if (actionId === "inspectIndex") return "Inspect Index";
  if (actionId === "rebuildIndex") return "Rebuild Project Index";
  if (actionId === "rebuildSdkIndex") return "Rebuild SDK Index";
  if (actionId === "configureSdk") return "Configure SDK";
  if (actionId === "indexCurrentFile") return "Index Current File";
  if (actionId === "inspectParserFailures") return "Show Parser Failures";
  if (actionId === "inspectUnresolvedImports") return "Show Unresolved Imports";
  return null;
}

export function buildQueryExplainTimeline({
  frontend,
  backend,
  limit = 8,
}: {
  frontend: RecentQueryExplain[];
  backend: WorkspaceIndexEvent[];
  limit?: number;
}): QueryExplainTimelineItem[] {
  const frontendItems = frontend.map((event) => ({
    id: event.id,
    source: "frontend" as const,
    severity: "info",
    title: `frontend · info · ${event.kind} · ${event.query}`,
    message: event.message,
    summary: summarizeQueryEnvelopeExplain(event.explain),
    raw: event.explain.join("\n"),
    createdAt: event.createdAt,
    displayTime: formatTimelineTime(event.createdAt),
  }));
  const backendItems = backend.map((event) => ({
    id: event.eventId,
    source: "backend" as const,
    severity: event.severity || "info",
    title: `backend · ${event.severity || "info"} · ${event.kind} · ${event.phase}`,
    message: event.message,
    summary: summarizeQueryEventPayload(event.payloadJson),
    raw: event.payloadJson,
    createdAt: event.createdAt,
    displayTime: formatTimelineTime(event.createdAt),
  }));

  return [...frontendItems, ...backendItems]
    .sort(compareTimelineItems)
    .slice(0, limit);
}

function compareTimelineItems(left: QueryExplainTimelineItem, right: QueryExplainTimelineItem) {
  const byTime = right.createdAt - left.createdAt;
  if (byTime !== 0) return byTime;
  if (left.source !== right.source) return left.source === "backend" ? -1 : 1;
  return left.id.localeCompare(right.id);
}

function formatTimelineTime(createdAt: number) {
  if (createdAt < 1000) return `${createdAt}ms`;
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return `${createdAt}ms`;
  return date.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function findExplainValue(explain: string[], key: string) {
  const prefix = `${key}:`;
  return explain.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}

function formatExplainAction(action?: string) {
  if (action === "waitForIndex") {
    return "Index is still catching up. Retry after indexing finishes.";
  }
  if (action === "rebuildIndex") {
    return "Index data is missing. Rebuild the index.";
  }
  if (action === "indexCurrentFile") {
    return "Current file index is missing. Index the current file.";
  }
  if (action === "inspectIndex") {
    return "Index needs inspection before this query can be trusted.";
  }
  if (action === "configureSdk") {
    return "SDK index is not configured. Configure SDK settings.";
  }
  return null;
}

function formatExplainActionLabel(action?: string) {
  if (action === "waitForIndex") return "Wait for index";
  if (action === "rebuildIndex") return "Rebuild index";
  if (action === "rebuildSdkIndex") return "Rebuild SDK index";
  if (action === "inspectIndex") return "Inspect index";
  if (action === "configureSdk") return "Configure SDK";
  if (action === "indexCurrentFile") return "Index current file";
  if (action === "inspectParserFailures") return "Inspect parser failures";
  if (action === "inspectUnresolvedImports") return "Inspect unresolved imports";
  if (action === "showEmptyResult") return "Show empty result";
  if (action === "useResults") return "Use results";
  return action ?? null;
}

function emptyActionSummary(actionId: string): QueryEnvelopeExplainSummary {
  return {
    actionId,
    action: formatExplainActionLabel(actionId),
    used: null,
    skipped: null,
    readiness: null,
    resultCount: null,
    generation: null,
    retryable: null,
    searchMetrics: null,
  };
}

function formatExplainList(value?: string) {
  if (!value || value === "none") return value ?? null;
  return value.split(",").map((item) => item.trim()).filter(Boolean).join(", ");
}

function formatSkippedExplain(value?: string) {
  if (!value) return null;
  if (value === "none") return "none";
  return formatExplainList(value);
}

function formatGeneration(served?: string, requested?: string) {
  if (!served && !requested) return null;
  return `${served && served !== "none" ? served : "none"} / ${requested ?? "unknown"}`;
}

function formatBoolean(value?: string) {
  if (value === "true") return "yes";
  if (value === "false") return "no";
  return value ?? null;
}

function formatSearchMetrics(searched?: string, skipped?: string, limitReached?: string) {
  const parts = [];
  if (searched) parts.push(`searched ${searched} file(s)`);
  if (skipped && skipped !== "0") parts.push(`skipped ${skipped} prefiltered file(s)`);
  if (limitReached) parts.push(`limit reached: ${formatBoolean(limitReached) ?? limitReached}`);
  return parts.length ? parts.join(", ") : null;
}
