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
      hvigorWrapperCommand: null,
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

  it("infers the module for a selected module directory", () => {
    const project = detectHarmonyBuildProject("/workspace/Demo", files);

    expect(inferBuildModuleForPath(project, "/workspace/Demo/feature")).toBe("feature");
    expect(inferBuildModuleForPath(project, "/workspace/Demo/feature/src")).toBe("feature");
  });

  it("falls back to the default module for project-level files", () => {
    const project = detectHarmonyBuildProject("/workspace/Demo", files);

    expect(inferBuildModuleForPath(project, "/workspace/Demo/build-profile.json5")).toBe("entry");
  });

  it("prefers the Windows Hvigor wrapper when only hvigorw.bat is visible", () => {
    const project = detectHarmonyBuildProject("C:/workspace/Demo", [
      "C:/workspace/Demo/build-profile.json5",
      "C:/workspace/Demo/hvigorfile.ts",
      "C:/workspace/Demo/hvigorw.bat",
      "C:/workspace/Demo/entry/src/main/ets/pages/Index.ets",
    ]);

    expect(project.hasHvigorWrapper).toBe(true);
    expect(project.hvigorWrapperCommand).toBe("hvigorw.bat");
  });
});
