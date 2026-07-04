import { formatQueryEnvelopeExplain } from "@/features/workspace/workspace-query-explain-model";
import type { UsageResult } from "@/features/workspace/usage-search";

export type DefinitionQuerySource = "keyboard" | "modifierClick";
export type DefinitionMissCause = "indexedNoTarget" | "languageAndFallbackNoTarget";
export type DefinitionCandidateSource = "indexed" | "semantic" | "fallback";
export type DefinitionResolvedSource = "indexed" | "semantic" | "fallback";
export type DefinitionReadinessState = "ready" | "partial" | "stale" | "missing";
export type DefinitionUnavailableCause = "missingPosition" | "settingsApplying" | "lookupUnavailable";
export type DefinitionPanelCandidate = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type DefinitionMissMessageInput = {
  source: DefinitionQuerySource;
  cause: DefinitionMissCause;
  explanation?: string | null;
};
export type DefinitionReadinessEnvelope = {
  items: DefinitionPanelCandidate[];
  readiness: {
    state: DefinitionReadinessState | "blocked";
    reason?: string | null;
  };
  explain?: string[];
};
export type DefinitionEnvelopeDecision =
  | { kind: "blocked"; message: string }
  | { kind: "candidates"; items: DefinitionPanelCandidate[]; readinessState: DefinitionReadinessState }
  | { kind: "resolved"; target: DefinitionPanelCandidate; readinessState: DefinitionReadinessState }
  | { kind: "waitForRefresh"; count: number; readinessState: "partial" | "stale" }
  | { kind: "defer" };

export function formatDefinitionEnvelopeExplanation(explain?: string[]) {
  return formatQueryEnvelopeExplain(explain);
}

export function decideDefinitionEnvelope(envelope: DefinitionReadinessEnvelope): DefinitionEnvelopeDecision {
  const readinessState = envelope.readiness.state;
  if (readinessState === "blocked") {
    return {
      kind: "blocked",
      message: envelope.readiness.reason ?? "Definition lookup is blocked while the index is preparing.",
    };
  }
  const canUseCandidate = readinessState === "ready" || envelope.items.length === 1;
  if (envelope.items.length > 1 && canUseCandidate) {
    return { kind: "candidates", items: envelope.items, readinessState };
  }
  if (envelope.items.length === 1 && canUseCandidate) {
    return { kind: "resolved", target: envelope.items[0], readinessState };
  }
  if ((readinessState === "partial" || readinessState === "stale") && envelope.items.length > 1) {
    return { kind: "waitForRefresh", count: envelope.items.length, readinessState };
  }
  return { kind: "defer" };
}

export function formatDefinitionUnavailableStatus(cause: DefinitionUnavailableCause) {
  if (cause === "missingPosition") {
    return "Ctrl+Click received, but editor position could not be resolved";
  }
  if (cause === "settingsApplying") {
    return "SDK settings are still applying";
  }
  return "Go to Definition unavailable";
}

export function formatDefinitionUnavailableDebugMessage(
  source: DefinitionQuerySource,
  cause: DefinitionUnavailableCause,
) {
  if (source !== "modifierClick") {
    return undefined;
  }
  if (cause === "missingPosition") {
    return "Ctrl+Click reached AppShell, but the editor could not resolve a document position.";
  }
  if (cause === "settingsApplying") {
    return "Ctrl+Click is paused while SDK settings are applying.";
  }
  return "Ctrl+Click reached AppShell, but definition lookup is unavailable for the current workspace.";
}

export function formatDefinitionQueryStatus(
  source: DefinitionQuerySource,
  basename: string,
  line: number,
  column: number,
) {
  const prefix = source === "modifierClick" ? "Ctrl+Click" : "Go to Definition";
  return `${prefix} query: ${basename}:${line}:${column}`;
}

export function formatDefinitionQueryDebugMessage(
  source: DefinitionQuerySource,
  basename: string,
  line: number,
  column: number,
) {
  if (source !== "modifierClick") {
    return undefined;
  }
  return `Ctrl+Click query fired at ${basename}:${line}:${column}. Waiting for language lookup...`;
}

export function formatDefinitionBlockedStatus(message: string) {
  return `Go to Definition blocked: ${message}`;
}

export function formatDefinitionBlockedDebugMessage(source: DefinitionQuerySource, message: string) {
  return source === "modifierClick" ? `Ctrl+Click blocked: ${message}` : undefined;
}

export function formatDefinitionMissMessage({
  source,
  cause,
  explanation,
}: DefinitionMissMessageInput) {
  const prefix = source === "modifierClick" ? "Ctrl+Click" : "Go to Definition";
  if (explanation) {
    return `${prefix} miss: ${explanation}`;
  }
  return `${prefix} miss: ${defaultDefinitionMissReason(cause)}`;
}

export function definitionCandidatesToUsageItems(candidates: DefinitionPanelCandidate[]): UsageResult[] {
  return candidates.map((item) => ({
    path: item.path,
    line: item.line,
    column: item.column,
    preview: item.preview,
    kind: "definition",
    confidence: "fallback",
  }));
}

export function formatDefinitionCandidateStatus(count: number) {
  return `Definition candidates: ${count}`;
}

export function formatDefinitionCandidatePanelMessage(readinessState: string) {
  return readinessState === "ready" ? undefined : `Index is ${readinessState}; choose an exact definition candidate.`;
}

export function formatDefinitionCandidateDebugMessage(
  source: DefinitionQuerySource,
  candidateSource: DefinitionCandidateSource,
  count: number,
) {
  if (source !== "modifierClick") {
    return undefined;
  }
  return `Ctrl+Click found ${count} ${candidateSource} definition candidates. Choose one from the editor query panel.`;
}

export function formatDefinitionRefreshWaitMessage(count: number, readinessState: "partial" | "stale") {
  return `Go to Definition has ${count} ${readinessState} candidates; wait for the index to refresh.`;
}

export function formatDefinitionResolvedStatus(
  target: Pick<DefinitionPanelCandidate, "path" | "line" | "column">,
  basename: string,
  resolvedSource: DefinitionResolvedSource,
) {
  const label = resolvedSource === "fallback" ? "Definition fallback" : "Definition";
  return `${label}: ${basename}:${target.line}:${target.column}`;
}

export function formatDefinitionResolvedDebugMessage(
  source: DefinitionQuerySource,
  target: Pick<DefinitionPanelCandidate, "line" | "column">,
  basename: string,
  resolvedSource: DefinitionResolvedSource,
  readinessState?: DefinitionReadinessState,
) {
  if (source !== "modifierClick") {
    return undefined;
  }
  const resolver = definitionResolvedDebugResolver(resolvedSource, readinessState);
  return `${resolver} resolved Ctrl+Click to ${basename}:${target.line}:${target.column}.`;
}

function defaultDefinitionMissReason(cause: DefinitionMissCause) {
  return cause === "indexedNoTarget"
    ? "indexed definition lookup returned no target"
    : "language service and local fallback returned no target";
}

function definitionResolvedDebugResolver(
  resolvedSource: DefinitionResolvedSource,
  readinessState?: DefinitionReadinessState,
) {
  if (resolvedSource === "indexed") {
    return readinessState === "ready" ? "Index" : `Index (${readinessState ?? "partial"})`;
  }
  return resolvedSource === "semantic" ? "Language service" : "Same-file fallback";
}
