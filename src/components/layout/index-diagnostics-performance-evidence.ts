import type { WorkspaceIndexEvent } from "@/features/workspace/workspace-index-api-types";

type DeepLayerPerformancePayload = {
  slowestStage?: unknown;
  slowestSource?: unknown;
  slowestDurationMs?: unknown;
  sampleCount?: unknown;
  violations?: unknown;
};

type DeepLayerPerformanceViolation = {
  stage?: unknown;
  source?: unknown;
  durationMs?: unknown;
  thresholdMs?: unknown;
  pathCount?: unknown;
  chunkIndex?: unknown;
};

export function formatPerformanceEventEvidence(event: WorkspaceIndexEvent) {
  if (event.scope !== "performance" || event.kind !== "deep-layer") {
    return [];
  }
  const payload = parsePerformancePayload(event.payloadJson);
  if (!payload) {
    return [];
  }
  const violations = Array.isArray(payload.violations) ? payload.violations : [];
  return [
    `performance: slowest=${stringValue(payload.slowestStage)} source=${stringValue(payload.slowestSource)} `
    + `duration=${numberValue(payload.slowestDurationMs)}ms samples=${numberValue(payload.sampleCount)} `
    + `violations=${violations.length}`,
    ...violations.slice(0, 3).map(formatPerformanceViolation),
  ];
}

function parsePerformancePayload(payloadJson: string): DeepLayerPerformancePayload | null {
  try {
    return JSON.parse(payloadJson) as DeepLayerPerformancePayload;
  } catch {
    return null;
  }
}

function formatPerformanceViolation(rawViolation: unknown) {
  const violation = rawViolation as DeepLayerPerformanceViolation;
  return `violation: ${stringValue(violation.stage)} ${stringValue(violation.source)} `
    + `${numberValue(violation.durationMs)}ms > ${numberValue(violation.thresholdMs)}ms `
    + `paths=${numberValue(violation.pathCount)} chunk=${numberValue(violation.chunkIndex)}`;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : "none";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
