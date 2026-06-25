import { describe, expect, it } from "vitest";
import {
  detectHarmonyBuildProject,
  inferBuildModuleForPath,
} from "@/features/build/build-project-detector";

describe("Harmony build project detector", () => {
  const files = [
    "/workspace/Demo/build-profile.json5",
    "/workspace/Demo/hvigorfile.ts",
    "/workspace/Demo/oh-package.json5",
    "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
    "/workspace/Demo/feature/src/main/ets/pages/Feature.ets",
    "/workspace/Demo/common/src/main/ets/Common.ets",
  ];

  it("detects HarmonyOS project markers and modules from visible workspace files", () => {
    expect(detectHarmonyBuildProject("/workspace/Demo", files)).toEqual({
      rootPath: "/workspace/Demo",
      isHarmonyProject: true,
      hasHvigorWrapper: false,
      hasHvigorFile: true,
      hasBuildProfile: true,
      hasOhPackage: true,
      modules: ["common", "entry", "feature"],
      defaultModule: "entry",
    });
  });

  it("infers the module for an active file under module/src/main", () => {
    const project = detectHarmonyBuildProject("/workspace/Demo", files);

    expect(inferBuildModuleForPath(project, "/workspace/Demo/feature/src/main/ets/pages/Feature.ets")).toBe("feature");
    expect(inferBuildModuleForPath(project, "/workspace/Demo/entry/src/main/ets/pages/Index.ets")).toBe("entry");
  });

  it("falls back to the default module for project-level files", () => {
    const project = detectHarmonyBuildProject("/workspace/Demo", files);

    expect(inferBuildModuleForPath(project, "/workspace/Demo/build-profile.json5")).toBe("entry");
  });
});
