import { describe, expect, it } from "vitest";
import { extractBuildArtifacts } from "@/features/build/build-artifacts";
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
import { defaultBuildDiagnosticMatchers, parseBuildDiagnostics, type BuildDiagnosticMatcher } from "@/features/build/build-diagnostics";
import { planHarmonyBuildCommand } from "@/features/build/build-command-planner";
import { createBuildEnvironmentSnapshot } from "@/features/build/build-environment-snapshot";
import { createBuildToolchainEnvironment } from "@/features/build/build-toolchain-environment";
import { assessBuildFreshness } from "@/features/build/build-freshness";
import { parseBuildProblems } from "@/features/build/build-output-parser";
import { preflightHarmonyBuild } from "@/features/build/build-preflight";
import { createBuildIntent, createBuildResultFromTerminalRun } from "@/features/build/build-run-model";
import { listBuildRunSummaries } from "@/features/build/build-run-summary";
import { createBuildStore } from "@/features/build/build-store";
import { createProblemsStore } from "@/features/problems/problems-store";

describe("build run model", () => {
  it("prepends the configured Node directory and exposes the Harmony SDK to Hvigor", () => {
    expect(createBuildToolchainEnvironment({
      harmonySdkPath: "/sdk/harmony",
      semanticWorkerPath: "",
      nodePath: "/tools/node",
      autoDetect: false,
    })).toEqual({
      pathEntries: ["/tools/node"],
      environment: {
        ARKLINE_HARMONY_SDK_PATH: "/sdk/harmony",
        DEVECO_SDK_HOME: "/sdk/harmony",
        HARMONY_SDK_HOME: "/sdk/harmony",
        HOS_SDK_HOME: "/sdk/harmony",
        OHOS_SDK_HOME: "/sdk/harmony",
      },
    });
  });

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

describe("build configuration memory", () => {
  it("restores the most recently used project configuration", () => {
    const store = createBuildStore();

    store.loadConfigurations([
      {
        id: "hap-entry-debug",
        name: "HAP entry debug",
        target: "hap",
        moduleName: "entry",
        product: "default",
        buildMode: "debug",
        fastMode: false,
        lastUsedAt: 10,
      },
      {
        id: "app-project-release",
        name: "APP project release",
        target: "app",
        moduleName: "entry",
        product: "china",
        buildMode: "release",
        fastMode: true,
        lastUsedAt: 20,
      },
    ]);

    expect(store.state.activeConfigurationId).toBe("app-project-release");
    expect(store.state.lastTarget).toBe("app");
    expect(store.state.product).toBe("china");
    expect(store.state.buildMode).toBe("release");
    expect(store.state.fastMode).toBe(true);
  });

  it("uses the only legacy configuration when it has no usage timestamp", () => {
    const store = createBuildStore();

    store.loadConfigurations([{
      id: "hap-entry-release",
      name: "HAP entry release",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "release",
      fastMode: false,
    }]);

    expect(store.state.activeConfigurationId).toBe("hap-entry-release");
    expect(store.state.buildMode).toBe("release");
  });

  it("returns to current settings when the configuration selection is cleared", () => {
    const store = createBuildStore();
    store.loadConfigurations([{
      id: "hap-entry-debug",
      name: "HAP entry debug",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      fastMode: false,
      lastUsedAt: 10,
    }]);

    store.selectConfiguration("");

    expect(store.state.activeConfigurationId).toBeNull();
    expect(store.state.message).toBe("Using current build settings");
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
      command: "./hvigorw clean --no-daemon && ./hvigorw --mode module -p module=entry@china -p product=china -p buildMode=release assembleHap --no-daemon",
      target: "hap",
      scope: "module",
      moduleName: "entry",
      product: "china",
      buildMode: "release",
      clean: true,
      fastMode: false,
      dependencyRestore: false,
      toolchain: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "/opt/arkts-worker/index.js",
        nodePath: "/opt/node",
        autoDetect: false,
      },
    });
  });
});

describe("build command preflight", () => {
  it("uses the detected Windows Hvigor wrapper command", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "C:/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: true,
      fastMode: false,
      wrapperCommand: "hvigorw.bat",
    });

    expect(plan.command).toBe("hvigorw.bat clean --no-daemon && hvigorw.bat --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon");
  });

  it("restores project dependencies before clean and build when required", () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: true,
      fastMode: false,
      restoreDependencies: true,
      ohpmCommand: "/opt/deveco/tools/ohpm/bin/ohpm",
    });

    expect(plan.steps.map((step) => step.label)).toEqual(["Dependencies", "Clean", "Build"]);
    expect(plan.steps[0]).toEqual(expect.objectContaining({
      program: "/opt/deveco/tools/ohpm/bin/ohpm",
      args: ["install", "--all"],
    }));
  });

  it("blocks builds when the Harmony project has no Hvigor wrapper", () => {
    const result = preflightHarmonyBuild({
      project: {
        rootPath: "/workspace/Demo",
        isHarmonyProject: true,
        hasHvigorWrapper: false,
        hvigorWrapperCommand: null,
        hasHvigorFile: true,
        hasBuildProfile: true,
        hasOhPackage: true,
        modules: ["entry"],
        defaultModule: "entry",
        products: ["default"],
        defaultProduct: "default",
        productSigning: [{ product: "default", signingConfig: "default", ready: true, issues: [] }],
      },
      settings: {
        harmonySdkPath: "/opt/harmony-sdk",
        semanticWorkerPath: "",
        nodePath: "/opt/node",
        autoDetect: false,
      },
      target: "hap",
      moduleName: "entry",
      product: "default",
    });

    expect(result.canBuild).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      severity: "error",
      code: "missing-hvigor-wrapper",
    }));
  });

  it("allows unsigned builds when the selected product has no signing config", () => {
    const result = preflightHarmonyBuild({
      project: {
        rootPath: "/workspace/Demo",
        isHarmonyProject: true,
        hasHvigorWrapper: true,
        hvigorWrapperCommand: "./hvigorw",
        hasHvigorFile: true,
        hasBuildProfile: true,
        hasOhPackage: true,
        modules: ["entry"],
        defaultModule: "entry",
        products: ["default"],
        defaultProduct: "default",
        productSigning: [{
          product: "default",
          signingConfig: null,
          ready: false,
          issues: ["product does not reference signingConfig"],
        }],
      },
      target: "hap",
      moduleName: "entry",
      product: "default",
    });

    expect(result.canBuild).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "missing-signing-config",
      severity: "warning",
    }));
  });

  it("allows unsigned builds when signing materials are incomplete", () => {
    const result = preflightHarmonyBuild({
      project: {
        rootPath: "/workspace/Demo",
        isHarmonyProject: true,
        hasHvigorWrapper: true,
        hvigorWrapperCommand: "./hvigorw",
        hasHvigorFile: true,
        hasBuildProfile: true,
        hasOhPackage: true,
        modules: ["entry"],
        defaultModule: "entry",
        products: ["default"],
        defaultProduct: "default",
        productSigning: [{
          product: "default",
          signingConfig: "default",
          ready: false,
          issues: ["material.profile file does not exist"],
        }],
      },
      target: "hap",
      moduleName: "entry",
      product: "default",
    });

    expect(result.canBuild).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "invalid-signing-material",
      severity: "warning",
      hint: "material.profile file does not exist",
    }));
  });

  it("blocks a product that requires a newer compile SDK API", () => {
    const result = preflightHarmonyBuild({
      project: {
        rootPath: "/workspace/Demo",
        isHarmonyProject: true,
        hasHvigorWrapper: true,
        hvigorWrapperCommand: "./hvigorw",
        hasHvigorFile: true,
        hasBuildProfile: true,
        hasOhPackage: true,
        modules: ["entry"],
        defaultModule: "entry",
        products: ["default"],
        defaultProduct: "default",
        productSigning: [{ product: "default", signingConfig: "default", ready: true, issues: [] }],
        productSdks: [{ product: "default", compileSdkVersion: "25" }],
      },
      environment: {
        canBuild: true,
        hvigorCommand: "/opt/deveco/tools/hvigor/bin/hvigorw",
        hvigorSource: "deveco",
        nodePath: "/opt/deveco/tools/node/bin",
        sdkPath: "/opt/deveco/sdk/default/openharmony",
        sdkApiVersion: "24",
        pathEntries: [],
        environment: {},
        checks: [],
      },
      target: "hap",
      moduleName: "entry",
      product: "default",
    });

    expect(result.canBuild).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: "incompatible-compile-sdk",
      message: "Product default requires compile SDK API 25, but the selected SDK provides API 24.",
    }));
  });

  it("leaves legacy platform-version compatibility to Hvigor", () => {
    const result = preflightHarmonyBuild({
      project: {
        rootPath: "/workspace/Demo",
        isHarmonyProject: true,
        hasHvigorWrapper: true,
        hvigorWrapperCommand: "./hvigorw",
        hasHvigorFile: true,
        hasBuildProfile: true,
        hasOhPackage: true,
        modules: ["entry"],
        defaultModule: "entry",
        products: ["default"],
        defaultProduct: "default",
        productSigning: [{ product: "default", signingConfig: "default", ready: true, issues: [] }],
        productSdks: [{ product: "default", compileSdkVersion: "5.0.0" }],
      },
      environment: {
        canBuild: true,
        nodePath: "/opt/node/bin",
        sdkPath: "/opt/sdk",
        sdkApiVersion: "4",
        pathEntries: [],
        environment: {},
        checks: [],
      },
      target: "hap",
      moduleName: "entry",
      product: "default",
    });

    expect(result.issues).not.toContainEqual(expect.objectContaining({
      code: "incompatible-compile-sdk",
    }));
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
        signature: "unknown",
      },
      {
        path: "/workspace/Demo/library/build/default/outputs/default/library.har",
        kind: "har",
        source: "output",
        signature: "not-applicable",
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
        signature: "unknown",
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
        signature: "signed",
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
        signature: "signed",
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
    expect(plan.command).toBe("./hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon");
    expect(plan.label).toBe("Build HAP entry debug");
    expect(plan.intent.scope).toBe("module");
    expect(plan.intent.moduleName).toBe("entry");
    expect(plan.steps).toEqual([
      {
        label: "Build",
        command: "./hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon",
        program: "./hvigorw",
        args: [
          "--mode",
          "module",
          "-p",
          "module=entry@default",
          "-p",
          "product=default",
          "-p",
          "buildMode=debug",
          "assembleHap",
          "--no-daemon",
        ],
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

    expect(plan.command).toBe("./hvigorw --mode project -p product=default -p buildMode=release assembleApp");
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

    expect(plan.command).toBe("./hvigorw clean --no-daemon && ./hvigorw --mode module -p module=entry@default -p product=default -p buildMode=debug assembleHap --no-daemon");
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

    expect(plan.command).toBe("./hvigorw --mode module -p module=entry@china -p product=china -p buildMode=release assembleHap");
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
        signature: "unknown",
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

  it("accepts an unsigned artifact when Hvigor exits successfully", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const artifactPath = "/workspace/Demo/entry/build/default/outputs/default/entry-default-unsigned.hap";

    const result = await executeHarmonyBuildPlan({
      runId: "build-verified-artifact",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "BUILD SUCCESSFUL",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        stopped: false,
      }),
      findBuildArtifacts: async () => [artifactPath],
    });

    expect(result.artifacts).toEqual([{
      path: artifactPath,
      kind: "hap",
      source: "filesystem",
      signature: "unsigned",
    }]);
    expect(result.status).toBe("success");
    expect(result.stderr).toBe("");
  });

  it("accepts a signed artifact from the filesystem", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const artifactPath = "/workspace/Demo/entry/build/default/outputs/default/entry-default-signed.hap";

    const result = await executeHarmonyBuildPlan({
      runId: "build-signed-artifact",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "BUILD SUCCESSFUL",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        stopped: false,
      }),
      findBuildArtifacts: async () => [artifactPath],
    });

    expect(result.status).toBe("success");
    expect(result.artifacts[0]?.signature).toBe("signed");
  });

  it("accepts the signed output when Hvigor also logs its unsigned intermediate", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
    });
    const signedPath = "/workspace/Demo/entry/build/default/outputs/default/entry-default-signed.hap";

    const result = await executeHarmonyBuildPlan({
      runId: "build-signed-with-intermediate",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "Signing /workspace/Demo/entry/build/intermediates/entry-default-unsigned.hap",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        stopped: false,
      }),
      findBuildArtifacts: async () => [signedPath],
    });

    expect(result.status).toBe("success");
    expect(result.artifacts.map((artifact) => artifact.signature)).toEqual(["unsigned", "signed"]);
  });

  it("does not report success when Hvigor exits zero without an artifact", async () => {
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
      runId: "build-missing-artifact",
      plan,
      runTerminalCommand: async (request) => ({
        runId: request.runId,
        command: request.command,
        stdout: "BUILD SUCCESSFUL",
        stderr: "",
        exitCode: 0,
        durationMs: 10,
        stopped: false,
      }),
      findBuildArtifacts: async () => [],
    });

    expect(result.status).toBe("failed");
    expect(result.stderr).toContain("no .hap artifact was found");
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

  it("does not start the build step when clean fails", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: true,
      fastMode: false,
    });
    const runTerminalCommand = vi.fn(async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: "",
      stderr: "clean failed",
      exitCode: 1,
      durationMs: 15,
      stopped: false,
    }));

    const result = await executeHarmonyBuildPlan({
      runId: "build-clean-failed",
      plan,
      runTerminalCommand,
    });

    expect(runTerminalCommand).toHaveBeenCalledTimes(1);
    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      program: "./hvigorw",
      args: ["clean", "--no-daemon"],
    }));
    expect(result.status).toBe("failed");
  });

  it("does not start Hvigor when dependency restoration fails", async () => {
    const plan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "hap",
      moduleName: "entry",
      product: "default",
      buildMode: "debug",
      clean: false,
      fastMode: false,
      restoreDependencies: true,
      ohpmCommand: "/opt/deveco/tools/ohpm/bin/ohpm",
    });
    const runTerminalCommand = vi.fn(async (request) => ({
      runId: request.runId,
      command: request.command,
      stdout: "",
      stderr: "ohpm registry unavailable",
      exitCode: 1,
      durationMs: 15,
      stopped: false,
    }));

    const result = await executeHarmonyBuildPlan({
      runId: "build-dependencies-failed",
      plan,
      runTerminalCommand,
    });

    expect(runTerminalCommand).toHaveBeenCalledTimes(1);
    expect(runTerminalCommand).toHaveBeenCalledWith(expect.objectContaining({
      program: "/opt/deveco/tools/ohpm/bin/ohpm",
      args: ["install", "--all"],
    }));
    expect(result.status).toBe("failed");
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
        signature: "signed",
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
        signature: "signed",
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

  it("summarizes current queued and completed build runs", () => {
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
    const queuedPlan = planHarmonyBuildCommand({
      rootPath: "/workspace/Demo",
      target: "app",
      moduleName: null,
      product: "default",
      buildMode: "release",
      clean: false,
      fastMode: false,
    });

    store.enqueue({ runId: "build-queued", plan: queuedPlan, requestedAt: 100 });
    store.start({ ...plan, runId: "build-running" });

    expect(listBuildRunSummaries(store.state).map((summary) => ({
      runId: summary.runId,
      label: summary.label,
      status: summary.status,
      eventCount: summary.eventCount,
    }))).toEqual([
      {
        runId: "build-running",
        label: "Build HAP entry debug",
        status: "running",
        eventCount: 1,
      },
      {
        runId: "build-queued",
        label: "Build APP project release",
        status: "queued",
        eventCount: 1,
      },
    ]);

    store.finish(createBuildResultFromTerminalRun({
      runId: "build-running",
      exitCode: 0,
      durationMs: 1200,
      stdout: "BUILD SUCCESSFUL",
      stderr: "",
      problems: [],
      artifacts: [{
        path: "/workspace/Demo/entry/build/default/outputs/default/entry-default.hap",
        kind: "hap",
        source: "output",
        signature: "signed",
      }],
      environment: createBuildEnvironmentSnapshot({ plan }),
    }));

    expect(listBuildRunSummaries(store.state)[1]).toMatchObject({
      runId: "build-running",
      label: "Build HAP entry debug",
      status: "success",
      durationMs: 1200,
      diagnosticCount: 0,
      artifactCount: 1,
      eventCount: 3,
    });
  });
});
