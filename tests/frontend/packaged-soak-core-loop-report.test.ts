import { describe, expect, it } from "vitest";
import {
  evaluateSoakReport,
  PACKAGED_SOAK_LIMITS,
} from "../../scripts/packaged-soak-model.mjs";
import { inspectFixture } from "../../scripts/packaged-soak-report.mjs";

describe("packaged core editing loop verdict", () => {
  it("accepts bounded editor input and scroll evidence", () => {
    expect(evaluateSoakReport(passingMetrics()).passed).toBe(true);
  });

  it("rejects missing, failed, or over-budget editor interactions", () => {
    expect(evaluateSoakReport(passingMetrics({
      successfulEditorInputCount: 0,
      successfulEditorScrollCount: 0,
      editorInteractionFailureCount: 1,
      rendererEditorInputP95Ms: PACKAGED_SOAK_LIMITS.rendererEditorInputP95Ms + 1,
      rendererEditorScrollP95Ms: PACKAGED_SOAK_LIMITS.rendererEditorScrollP95Ms + 1,
    })).failures).toEqual(expect.arrayContaining([
      "no-editor-input-evidence",
      "no-editor-scroll-evidence",
      "editor-interaction-failure",
      "renderer-editor-input-p95",
      "renderer-editor-scroll-p95",
    ]));
  });

  it("requires definition and member completion evidence for a real workspace", () => {
    expect(evaluateSoakReport(passingMetrics({
      semanticRequired: true,
      successfulDefinitionCount: 0,
      successfulCompletionCount: 0,
      definitionMissCount: 1,
      completionMissCount: 1,
    })).failures).toEqual(expect.arrayContaining([
      "definition-result-miss",
      "completion-result-miss",
      "no-definition-evidence",
      "no-member-completion-evidence",
    ]));
  });

  it("records reproducible real-workspace and SDK evidence", async () => {
    await expect(inspectFixture("C:\\fixtures\\ArkDemo", {
      kind: "real-workspace",
      revision: "0123456789abcdef",
      sdkIdentity: "OpenHarmony-6.0/API-20",
      sourcePath: "C:\\fixtures\\core-loop.json",
      sha256: "scenario-sha",
    })).resolves.toEqual({
      kind: "real-workspace",
      rootPath: "C:\\fixtures\\ArkDemo",
      revision: "0123456789abcdef",
      sdkIdentity: "OpenHarmony-6.0/API-20",
      scenarioPath: "C:\\fixtures\\core-loop.json",
      scenarioSha256: "scenario-sha",
    });
  });
});

function passingMetrics(overrides: Record<string, number | boolean> = {}) {
  return {
    rendererSearchP95Ms: 40,
    rendererJumpP95Ms: 80,
    rendererEditorInputP95Ms: 16,
    rendererEditorScrollP95Ms: 16,
    rendererDefinitionP95Ms: 120,
    rendererCompletionP95Ms: 100,
    rendererSearchP99Ms: 80,
    rendererJumpP99Ms: 120,
    rendererEditorInputP99Ms: 32,
    rendererEditorScrollP99Ms: 32,
    crashCount: 0,
    unresponsiveCount: 0,
    editorInteractionFailureCount: 0,
    pendingLoads: 0,
    staleApplyCount: 0,
    searchMissCount: 0,
    rssGrowthBytes: 0,
    privateGrowthBytes: 0,
    jsHeapGrowthBytes: 0,
    walGrowthBytes: 0,
    sharedSdkWalGrowthBytes: 0,
    workerRestartGrowth: 0,
    successfulSearchCount: 1,
    successfulJumpCount: 1,
    successfulEditorInputCount: 1,
    successfulEditorScrollCount: 1,
    semanticRequired: false,
    definitionMissCount: 0,
    completionMissCount: 0,
    successfulDefinitionCount: 0,
    successfulCompletionCount: 0,
    eventTimingSupported: true,
    longAnimationFrameSupported: true,
    interactionTimingCount: 1,
    interactionTimingP95Ms: 16,
    longTaskMaxMs: 80,
    causalTraceCount: 3,
    causalTraceErrorCount: 0,
    causalTraceRunningCount: 0,
    causalTraceKindCount: 3,
    processTreeSampleCount: 5,
    steadyProcessSampleCount: 5,
    indexedFileCount: 1,
    indexedContentFileCount: 1,
    eligibleContentFileCount: 1,
    stalledIndexTaskCount: 0,
    ...overrides,
  };
}
