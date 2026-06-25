import { createProblemsStore } from "@/features/problems/problems-store";

describe("problems store", () => {
  it("deduplicates diagnostics and keeps supported build sources", () => {
    const store = createProblemsStore();
    const diagnostic = {
      source: "lint" as const,
      severity: "error" as const,
      path: "main.ets",
      line: 4,
      column: 2,
      message: "Unexpected token",
    };

    const buildDiagnostic = { ...diagnostic, source: "build" as const };
    store.replace([diagnostic, diagnostic, buildDiagnostic]);

    expect(store.state.items).toEqual([diagnostic, buildDiagnostic]);
  });

  it("sorts errors before warnings", () => {
    const store = createProblemsStore();
    store.replace([
      { source: "format", severity: "warning", message: "format", path: "a.ets", line: 1, column: 1 },
      { source: "language", severity: "error", message: "type", path: "a.ets", line: 2, column: 1 },
    ]);
    expect(store.state.items.map((item) => item.severity)).toEqual(["error", "warning"]);
  });
});
