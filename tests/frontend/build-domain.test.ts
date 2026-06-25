import { describe, expect, it } from "vitest";
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { createBuildStore } from "@/features/build/build-store";
import { createProblemsStore } from "@/features/problems/problems-store";

describe("Harmony build command planner", () => {
  it("plans a module HAP build through the project wrapper without clean by default", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    expect(plan.cwd).toBe("/workspace/Demo");
    expect(plan.command).toBe("./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon");
    expect(plan.label).toBe("Build HAP entry debug");
  });

  it("plans a project APP build and keeps daemon available in fast mode", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: null,
      product: "default",
      buildMode: "release",
      clean: false,
      fastMode: true,
    });

    expect(plan.command).toBe("./hvigorw assembleApp --mode project -p product=default -p buildMode=release");
  });

  it("prefixes clean only when explicitly requested", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: true,
      fastMode: false,
    });

    expect(plan.command).toBe("./hvigorw clean --no-daemon && ./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon");
  });
});

describe("build output parser", () => {
  it("extracts Hvigor file diagnostics into build problems", () => {
    const output = [
      "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8",
      "Property width does not exist on type Foo.",
      "WARN: /workspace/Demo/entry/src/main/ets/pages/About.ets:4:2 deprecated API",
    ].join("\n");

    expect(parseBuildProblems(output)).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 12,
        column: 8,
        message: "Property width does not exist on type Foo.",
      },
      {
        source: "build",
        severity: "warning",
        path: "/workspace/Demo/entry/src/main/ets/pages/About.ets",
        line: 4,
        column: 2,
        message: "deprecated API",
      },
    ]);
  });

  it("allows build diagnostics in the shared problems store", () => {
    const store = createProblemsStore();
    store.replace([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 12,
        column: 8,
        message: "Build failed",
      },
    ]);

    expect(store.state.items).toHaveLength(1);
  });
});

describe("build store", () => {
  it("tracks a run lifecycle and last duration", () => {
    const store = createBuildStore();

    store.start({
      runId: "build-1",
      label: "Build HAP entry debug",
      command: "./hvigorw assembleHap",
      cwd: "/workspace/Demo",
      target: "hap",
    });
    expect(store.state.status).toBe("running");

    store.finish({
      exitCode: 0,
      durationMs: 1200,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      problems: [],
    });

    expect(store.state.status).toBe("success");
    expect(store.state.lastDurationMs).toBe(1200);
    expect(store.state.output).toContain("BUILD SUCCESSFUL");
  });
});
