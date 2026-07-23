export const SEARCH_UI_EVIDENCE_SCRIPT = `
  const phase = arguments[0];
  const queryLabel = arguments[1];
  const resultsLabel = arguments[2];
  const input = document.querySelector('[aria-label="' + queryLabel + '"]');
  const results = document.querySelector('[aria-label="' + resultsLabel + '"]');
  const active = document.activeElement;
  const buttons = results ? Array.from(results.querySelectorAll("button")) : [];
  const empty = results
    ? results.querySelector(".search-everywhere__empty, .palette-empty")
    : null;
  const status = document.querySelector('[aria-label="Status Bar Left"]');
  return {
    capturedAt: Date.now(),
    phase,
    queryLabel,
    resultsLabel,
    inputPresent: Boolean(input),
    inputValue: input && "value" in input ? input.value : null,
    activeLabel: active ? active.getAttribute("aria-label") : null,
    resultsPresent: Boolean(results),
    resultCount: buttons.length,
    resultLabels: buttons.slice(0, 5).map((button) =>
      button.getAttribute("aria-label") || (button.textContent || "").trim().slice(0, 240)
    ),
    emptyText: empty ? (empty.textContent || "").trim() : null,
    statusText: status ? (status.textContent || "").trim().slice(0, 500) : null,
  };
`;

export function shouldRecordSearchEvidence(evidence, currentCount, limit = 40) {
  return currentCount < limit
    && (
      evidence.phase.endsWith("-miss")
      || evidence.phase.endsWith("-typed")
      || evidence.resultCount > 0
    );
}
