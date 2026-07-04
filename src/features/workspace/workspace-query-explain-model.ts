export type RecentQueryExplain = {
  id: string;
  kind: "search" | "definition" | "usages" | "completion";
  query: string;
  message: string;
  explain: string[];
  createdAt: number;
};

export function formatQueryEnvelopeExplain(explain?: string[]) {
  if (!explain?.length) return null;

  const reason = findExplainValue(explain, "reason");
  if (reason) return reason;

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

function findExplainValue(explain: string[], key: string) {
  const prefix = `${key}:`;
  return explain.find((item) => item.startsWith(prefix))?.slice(prefix.length);
}
