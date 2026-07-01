export type UsageResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
  kind: string;
  confidence: string;
};

export type UsageSearchState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  items: UsageResult[];
  requestedSymbol?: {
    path: string;
    line: number;
    column: number;
    symbolText?: string;
  };
  message?: string;
};

export function idleUsageSearchState(): UsageSearchState {
  return {
    status: "idle",
    items: [],
  };
}
