import { describe, expect, it } from "vitest";
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { createBuildIntent, createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
import { createBuildStore } from "@/features/build/build-store";
import { createProblemsStore } from "@/features/problems/problems-store";

describe("build run model", () => {
  it("normalizes UI build choices into a durable build intent", () => {
    const intent = createBuildIntent({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "  entry  ",
      product: "  default  ",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    expect(intent).toEqual({
      kind: "build",
      projectRoot: "/workspace/Demo",
      target: "hap",
      scope: "module",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
  });

  it("uses project scope and no module for APP intents", () => {
    const intent = createBuildIntent({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: "entry",
      product: "",
      buildMode: "release",
      clean: true,
      fastMode: true,
    });

    expect(intent.scope).toBe("project");
    expect(intent.moduleName).toBeNull();
    expect(intent.product).toBe("default");
  });

  it("converts a terminal run into a structured build result", () => {
    const result = createBuildResultFromTerminalRun({
      runId: "build-1",
      planId: "plan-1",
      exitCode: 1,
      durationMs: 90,
      stdout: "",
      stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
      problems: [
        {
          source: "build",
          severity: "error",
          path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
          line: 12,
          column: 8,
          message: "Property width does not exist.",
        },
      ],
    });

    expect(result.status).toBe("failed");
    expect(result.output).toContain("Property width does not exist.");
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("build environment snapshot", () => {
  it("captures build intent command and configured toolchain paths", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "china",
      buildMode: "release",
      clean: true,
      fastMode: false,
    });

    const snapshot = createBuildEnvironmentSnapshot({
      plan,
      settings: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "/opt/arkts-worker/index.js",
        nodePath: "/opt/node",
        autoDetect: false,
      },
    });

    expect(snapshot).toEqual({
      projectRoot: "/workspace/Demo",
      cwd: "/workspace/Demo",
      command: "./hvigorw clean --no-daemon && ./hvigorw assembleHap --mode module -p module=entry@china -p product=china -p buildMode=release --no-daemon",
      target: "hap",
      scope: "module",
      moduleName: "entry",
      product: "china",
      buildMode: "release",
      clean: true,
      fastMode: false,
      toolchain: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "/opt/arkts-worker/index.js",
        nodePath: "/opt/node",
        autoDetect: false,
      },
    });
  });
});

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
    expect(plan.intent.scope).toBe("module");
    expect(plan.intent.moduleName).toBe("entry");
    expect(plan.steps).toEqual([
      {
        label: "Build",
        command: "./hvigorw assembleHap --mode module -p module=entry@default -p product=default -p buildMode=debug --no-daemon",
      },
    ]);
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
    expect(plan.steps.map((step) => step.label)).toEqual(["Clean", "Build"]);
  });
});

describe("build controller", () => {
  it("creates a Harmony build plan from build state", () => {
    const store = createBuildStore();
    store.configure({
      lastTarget: "hap",
      moduleName: " entry ",
      product: " china ",
      buildMode: "release",
      fastMode: true,
    });

    const plan = createHarmonyBuildPlanFromState({
      rootPath: "/workspace/Demo",
      state: store.state,
      clean: false,
    });

    expect(plan.command).toBe("./hvigorw assembleHap --mode module -p module=entry@china -p product=china -p buildMode=release");
    expect(plan.intent.product).toBe("china");
  });

  it("executes a build plan through the terminal runner and returns parsed diagnostics", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    const result = await executeHarmonyBuildPlan({
      runId: "build-1",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.",
        exitCode: 1,
        durationMs: 90,
        stopped: false,
      }),
      settings: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "",
        nodePath: "/opt/node",
        autoDetect: false,
      },
    });

    expect(result.status).toBe("failed");
    expect(result.environment?.toolchain.nodePath).toBe("/opt/node");
    expect(result.environment?.moduleName).toBe("entry");
    expect(result.diagnostics).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 12,
        column: 8,
        message: "Property width does not exist.",
      },
    ]);
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
      ...planHarmonyBuildCommand({
        rootPath: "/workspace/Demo",
        target: "hap",
        moduleName: "entry",
        product: "default",
        buildMode: "debug",
        clean: false,
        fastMode: false,
      }),
      runId: "build-1",
    });
    expect(store.state.status).toBe("running");

    store.finish(createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 1200,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      problems: [],
    }));

    expect(store.state.status).toBe("success");
    expect(store.state.lastResult?.status).toBe("success");
    expect(store.state.lastDurationMs).toBe(1200);
    expect(store.state.output).toContain("BUILD SUCCESSFUL");
  });
});
