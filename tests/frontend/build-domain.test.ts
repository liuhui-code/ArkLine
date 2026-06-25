import { describe, expect, it } from "vitest";
import { extractBuildArtifacts } from "@/features/build/build-artifacts";
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
import { defaultBuildDiagnosticMatchers, parseBuildDiagnostics, type BuildDiagnosticMatcher } from "@/features/build/build-diagnostics";
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import { assessBuildFreshness } from "@/features/build/build-freshness";
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

describe("build artifacts", () => {
  it("extracts Harmony artifact paths from build output", () => {
    const artifacts = extractBuildArtifacts([
      "Generated artifact: /workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
      "Archive: /workspace/Demo/library/build/default/outputs/default/library.har",
    ].join("\n"));

    expect(artifacts).toEqual([
      {
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      },
      {
        path: "/workspace/Demo/library/build/default/outputs/default/library.har",
        kind: "har",
        source: "output",
      },
    ]);
  });

  it("deduplicates repeated artifact paths", () => {
    const artifacts = extractBuildArtifacts("out=/workspace/Demo/build/default/app/default/app.app\nagain /workspace/Demo/build/default/app/default/app.app");

    expect(artifacts).toEqual([
      {
        path: "/workspace/Demo/build/default/app/default/app.app",
        kind: "app",
        source: "output",
      },
    ]);
  });
});

describe("build freshness", () => {
  it("marks a matching successful build with artifacts as a current candidate", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const environment = createBuildEnvironmentSnapshot({ plan });
    const previous = createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 100,
      stdout: "",
      stderr: "",
      problems: [],
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      }],
      environment,
    });

    expect(assessBuildFreshness({ plan, environment, history: [previous] })).toEqual({
      status: "candidate-current",
      reason: "matching-success",
      matchingRunId: "build-1",
      artifactPaths: ["/workspace/Demo/entry/build/default/outputs/default/entry-default.hap"],
    });
  });

  it("does not mark a matching build current when artifacts are missing", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const environment = createBuildEnvironmentSnapshot({ plan });
    const previous = createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 100,
      stdout: "",
      stderr: "",
      problems: [],
      environment,
    });

    expect(assessBuildFreshness({ plan, environment, history: [previous] })).toEqual({
      status: "unknown",
      reason: "artifacts-missing",
      matchingRunId: "build-1",
      artifactPaths: [],
    });
  });

  it("reports stale when successful history does not match the current command", () => {
    const oldPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const nextPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: null,
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const previous = createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 100,
      stdout: "",
      stderr: "",
      problems: [],
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      }],
      environment: createBuildEnvironmentSnapshot({ plan: oldPlan }),
    });

    expect(assessBuildFreshness({
      plan: nextPlan,
      environment: createBuildEnvironmentSnapshot({ plan: nextPlan }),
      history: [previous],
    })).toEqual({
      status: "stale",
      reason: "command-changed",
      artifactPaths: [],
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
        stdout: "Generated artifact: /workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
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
    expect(result.artifacts).toEqual([
      {
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      },
    ]);
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

  it("executes a build plan with custom diagnostic matchers", async () => {
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
      runId: "build-2",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "",
        stderr: "PACKAGER_FAIL",
        exitCode: 1,
        durationMs: 70,
        stopped: false,
      }),
      diagnosticMatchers: [{
        id: "custom-packager",
        match: () => [{
          source: "build",
          severity: "error",
          path: "/workspace/Demo/build-profile.json5",
          line: 1,
          column: 1,
          message: "Packager failed",
        }],
      }],
    });

    expect(result.diagnostics).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/build-profile.json5",
        line: 1,
        column: 1,
        message: "Packager failed",
      },
    ]);
  });
});

describe("build diagnostic matchers", () => {
  it("uses default matchers to parse Hvigor file diagnostics", () => {
    const output = "ERROR: ArkTS:ERROR File: /workspace/Demo/entry/src/main/ets/pages/Index.ets:12:8\nProperty width does not exist.";

    expect(parseBuildDiagnostics(output, defaultBuildDiagnosticMatchers)).toEqual([
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

  it("allows custom build diagnostic matchers", () => {
    const customMatcher: BuildDiagnosticMatcher = {
      id: "custom-packager",
      match(output) {
        return output.includes("PACKAGER_FAIL")
          ? [{
            source: "build",
            severity: "error",
            path: "/workspace/Demo/build-profile.json5",
            line: 1,
            column: 1,
            message: "Packager failed",
          }]
          : [];
      },
    };

    expect(parseBuildDiagnostics("PACKAGER_FAIL", [customMatcher])).toEqual([
      {
        source: "build",
        severity: "error",
        path: "/workspace/Demo/build-profile.json5",
        line: 1,
        column: 1,
        message: "Packager failed",
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
    const lifecyclePlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    store.start({
      ...lifecyclePlan,
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
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      }],
      environment: createBuildEnvironmentSnapshot({ plan: lifecyclePlan }),
    }));

    expect(store.state.status).toBe("success");
    expect(store.state.lastResult?.status).toBe("success");
    expect(store.state.history).toHaveLength(1);
    expect(store.state.history[0]?.runId).toBe("build-1");
    expect(store.state.lastDurationMs).toBe(1200);
    expect(store.state.output).toContain("BUILD SUCCESSFUL");

    store.start({
      ...lifecyclePlan,
      runId: "build-2",
    });
    expect(store.state.freshness.status).toBe("candidate-current");
  });

  it("queues pending build plans in FIFO order", () => {
    const store = createBuildStore();
    const firstPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const secondPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: null,
      product: "default",
      buildMode: "release",
      clean: false,
      fastMode: false,
    });

    store.enqueue({ runId: "build-1", plan: firstPlan, requestedAt: 100 });
    store.enqueue({ runId: "build-2", plan: secondPlan, requestedAt: 200 });

    expect(store.state.queue.map((item) => item.runId)).toEqual(["build-1", "build-2"]);
    expect(store.dequeueNext()?.runId).toBe("build-1");
    expect(store.dequeueNext()?.runId).toBe("build-2");
    expect(store.dequeueNext()).toBeNull();
  });

  it("replaces queued plans with the same run id and clears the queue", () => {
    const store = createBuildStore();
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    store.enqueue({ runId: "build-1", plan, requestedAt: 100 });
    store.enqueue({ runId: "build-1", plan: { ...plan, label: "Replacement" }, requestedAt: 200 });

    expect(store.state.queue).toHaveLength(1);
    expect(store.state.queue[0]?.plan.label).toBe("Replacement");

    store.clearQueue();
    expect(store.state.queue).toEqual([]);
  });

  it("records build lifecycle events in sequence", () => {
    const store = createBuildStore();
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    store.start({ ...plan, runId: "build-1" });
    store.finish(createBuildResultFromTerminalRun({
      runId: "build-1",
      exitCode: 0,
      durationMs: 1200,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      problems: [{
        source: "build",
        severity: "warning",
        path: "/workspace/Demo/entry/src/main/ets/pages/Index.ets",
        line: 1,
        column: 1,
        message: "Warning",
      }],
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
      }],
      environment: createBuildEnvironmentSnapshot({ plan }),
    }));

    expect(store.eventsForRun("build-1").map((event) => event.kind)).toEqual([
      "started",
      "diagnostics",
      "artifacts",
      "finished",
    ]);
    expect(store.eventsForRun("build-1").map((event) => event.sequence)).toEqual([1, 2, 3, 4]);
  });

  it("records queued events and can clear event logs", () => {
    const store = createBuildStore();
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });

    store.enqueue({ runId: "build-1", plan, requestedAt: 100 });

    expect(store.state.events).toEqual([
      {
        sequence: 1,
        runId: "build-1",
        kind: "queued",
        message: "Queued Build HAP entry debug",
      },
    ]);

    store.clearEvents("build-1");
    expect(store.state.events).toEqual([]);
  });
});
