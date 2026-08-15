import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useBuildControllerState } from "@/components/layout/use-build-controller-state";
import type { BuildEnvironmentResolution, HarmonyBuildProject } from "@/features/build/build-model";
import { defaultSettings } from "@/features/settings/settings-store";
import type {
  TerminalRunRequest,
  TerminalRunResult,
  WorkspaceApi,
  WorkspaceViewModel,
} from "@/features/workspace/workspace-api";

const realProjectRoot = process.env.ARKLINE_REAL_BUILD_ROOT;

it.skipIf(!realProjectRoot)("verifies a real unsigned clean and incremental build through the ArkLine controller", async () => {
  const rootPath = path.resolve(realProjectRoot!);
  const hvigorCommand = process.env.ARKLINE_REAL_HVIGOR
    ?? "/Applications/DevEco-Studio.app/Contents/tools/hvigor/bin/hvigorw";
  const devecoRoot = path.resolve(path.dirname(hvigorCommand), "../../..");
  const nodeRoot = path.join(devecoRoot, "tools/node");
  const sdkRoot = path.join(devecoRoot, "sdk");
  const initialArtifacts = await findArtifacts(rootPath, ".hap");
  expect(initialArtifacts).toEqual([]);

  const project: HarmonyBuildProject = {
    rootPath,
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
    productSigning: [{
      product: "default",
      signingConfig: null,
      ready: false,
      issues: ["product does not reference signingConfig"],
    }],
    productSdks: [{ product: "default", compileSdkVersion: "24" }],
  };
  const environment: BuildEnvironmentResolution = {
    canBuild: true,
    hvigorCommand,
    hvigorSource: "deveco",
    ohpmCommand: path.join(devecoRoot, "tools/ohpm/bin/ohpm"),
    dependencyRestoreRequired: false,
    nodePath: path.join(nodeRoot, "bin/node"),
    sdkPath: sdkRoot,
    sdkApiVersion: "24",
    pathEntries: [path.join(nodeRoot, "bin")],
    environment: {
      DEVECO_SDK_HOME: sdkRoot,
      NODE_HOME: nodeRoot,
    },
    checks: [
      { name: "hvigor", available: true, detail: hvigorCommand },
      { name: "node", available: true, detail: nodeRoot },
      { name: "harmonySdk", available: true, detail: sdkRoot },
    ],
  };
  const workspace: WorkspaceViewModel = {
    rootName: path.basename(rootPath),
    rootPath,
    visibleFiles: [
      path.join(rootPath, "hvigorfile.ts"),
      path.join(rootPath, "build-profile.json5"),
      path.join(rootPath, "oh-package.json5"),
      path.join(rootPath, "entry/src/main/ets/pages/Index.ets"),
    ],
    fileTree: [],
    scanSummary: { scannedFiles: 4, skippedEntries: 0, truncated: false, excludeRules: [] },
  };
  const workspaceApi = {
    openFile: (filePath: string) => readFile(filePath, "utf8"),
    inspectHarmonyBuildProject: vi.fn(async () => project),
    resolveBuildEnvironment: vi.fn(async () => environment),
    loadBuildConfigurations: vi.fn(async () => []),
    saveBuildConfigurations: vi.fn(async () => undefined),
    runTerminalCommand,
    stopTerminalCommand: vi.fn(async () => undefined),
    findHarmonyBuildArtifacts: vi.fn(async () => findArtifacts(rootPath, ".hap")),
  } as unknown as WorkspaceApi;
  const { result } = renderHook(() => useBuildControllerState({
    workspace,
    workspaceApi,
    activePath: workspace.visibleFiles.at(-1) ?? null,
    selectedProjectPath: null,
    sdkSettings: defaultSettings().sdk,
    showBuild: vi.fn(),
    replaceBuildProblems: vi.fn(),
    onStatusChange: vi.fn(),
  }));

  await act(async () => {
    await result.current.runBuild(true);
  });

  expect(result.current.buildState.status).toBe("success");
  expect(result.current.buildState.preflight?.issues).toContainEqual(expect.objectContaining({
    code: "missing-signing-config",
    severity: "warning",
  }));
  const cleanArtifact = result.current.buildState.lastResult?.artifacts.at(0);
  expect(cleanArtifact).toEqual(expect.objectContaining({ signature: "unsigned" }));
  const cleanReceipt = await artifactReceipt(cleanArtifact!.path);
  const cleanDurationMs = result.current.buildState.lastResult!.durationMs;
  expect(cleanReceipt.size).toBeGreaterThan(0);

  await act(async () => {
    await result.current.runBuild(false);
  });

  expect(result.current.buildState.status).toBe("success");
  expect(result.current.buildState.lastResult?.output).toMatch(/UP-TO-DATE/i);
  const incrementalArtifact = result.current.buildState.lastResult?.artifacts.at(0);
  expect(incrementalArtifact).toEqual(expect.objectContaining({ signature: "unsigned" }));
  const incrementalReceipt = await artifactReceipt(incrementalArtifact!.path);
  const incrementalDurationMs = result.current.buildState.lastResult!.durationMs;
  expect(incrementalReceipt).toEqual(cleanReceipt);

  console.info("ARKLINE_REAL_BUILD_EVIDENCE", JSON.stringify({
    projectRoot: rootPath,
    clean: cleanReceipt,
    incremental: incrementalReceipt,
    cleanDurationMs,
    incrementalDurationMs,
    signature: incrementalArtifact!.signature,
  }));
}, 180_000);

async function runTerminalCommand(request: TerminalRunRequest): Promise<TerminalRunResult> {
  const startedAt = Date.now();
  const program = request.program ?? request.command;
  const args = request.args ?? [];
  const pathValue = [
    ...(request.pathEntries ?? []),
    process.env.PATH ?? "",
  ].filter(Boolean).join(path.delimiter);

  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd: request.cwd ?? undefined,
      env: { ...process.env, ...request.environment, PATH: pathValue },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (exitCode) => resolve({
      runId: request.runId,
      command: request.command,
      stdout,
      stderr,
      exitCode,
      durationMs: Date.now() - startedAt,
      stopped: false,
    }));
  });
}

async function findArtifacts(rootPath: string, extension: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name.endsWith(extension) && (await stat(entryPath)).size > 0) {
        results.push(entryPath);
      }
    }
  }
  await visit(rootPath);
  return results.sort();
}

async function artifactReceipt(artifactPath: string) {
  const content = await readFile(artifactPath);
  return {
    path: artifactPath,
    size: content.byteLength,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
