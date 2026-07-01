import { formatIndexExplainMessage } from "@/features/workspace/index-explain-model";
import type { WorkspaceIndexExplainResult } from "@/features/workspace/workspace-api";

function explain(overrides: Partial<WorkspaceIndexExplainResult>): WorkspaceIndexExplainResult {
  return {
    status: "notIndexed",
    message: "File has no index fingerprint",
    facts: [],
    recommendedAction: "rebuildIndex",
    ...overrides,
  };
}

describe("index explain model", () => {
  it("formats excluded path explanations with open-file action", () => {
    expect(formatIndexExplainMessage(explain({
      status: "excluded",
      message: "Path is excluded from workspace indexing",
      recommendedAction: "openFile",
    }))).toBe("Path is excluded from workspace indexing. Open File.");
  });

  it("formats sdk-not-ready explanations with configure-sdk action", () => {
    expect(formatIndexExplainMessage(explain({
      status: "sdkNotReady",
      message: "SDK API index is not ready for this workspace",
      recommendedAction: "configureSdk",
    }))).toBe("SDK API index is not ready for this workspace. Configure SDK.");
  });

  it("formats parser-failed explanations with report-bug action", () => {
    expect(formatIndexExplainMessage(explain({
      status: "parserFailed",
      message: "File parser failed while building index data",
      recommendedAction: "reportBug",
    }))).toBe("File parser failed while building index data. Report Bug.");
  });
});
