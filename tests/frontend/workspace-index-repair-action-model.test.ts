import { describe, expect, it } from "vitest";
import {
  repairActionFromPayload,
  repairActionFromRecommendedAction,
} from "@/features/workspace/workspace-index-repair-action-model";

describe("workspace index repair action model", () => {
  it("maps query recommendations to health repair actions", () => {
    expect(repairActionFromRecommendedAction("rebuildIndex")).toBe("rebuildProjectIndex");
    expect(repairActionFromRecommendedAction("rebuildSdkIndex")).toBe("rebuildSdkIndex");
    expect(repairActionFromRecommendedAction("configureSdk")).toBe("configureSdk");
    expect(repairActionFromRecommendedAction("indexCurrentFile")).toBe("indexCurrentFile");
    expect(repairActionFromRecommendedAction("inspectParserFailures")).toBe("inspectParserFailures");
    expect(repairActionFromRecommendedAction("inspectUnresolvedImports")).toBe("inspectUnresolvedImports");
    expect(repairActionFromRecommendedAction("waitForIndex")).toBeNull();
  });

  it("ignores malformed payloads", () => {
    expect(repairActionFromPayload(JSON.stringify({ recommendedAction: "configureSdk" }))).toBe("configureSdk");
    expect(repairActionFromPayload("{broken")).toBeNull();
  });
});
