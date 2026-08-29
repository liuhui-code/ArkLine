import { describe, expect, it } from "vitest";

// Runtime packaging script imported for regression coverage.
// @ts-ignore The launcher is a Node ESM script, not a typed app module.
import {
  buildPackagingSteps,
  getOutputSummary,
  formatPackagingStepEnd,
  formatPackagingStepStart,
  packagingStepTimeoutMs,
  packagingSpawnOptions,
  resolvePnpmExecutable,
  runStepWithRetry,
} from "../../scripts/package-windows.mjs";
// @ts-ignore The staging helper is a Node ESM script, not a typed app module.
import { portableBundlePaths } from "../../scripts/stage-windows-portable.mjs";

describe("package windows launcher", () => {
  it("builds the mac packaging flow as a native no-bundle binary", () => {
    expect(buildPackagingSteps({ target: "mac", hostPlatform: "darwin" })).toEqual([
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      { name: "semantic-sidecar", command: "node", args: ["scripts/build-semantic-sidecar.mjs"] },
      { name: "indexer-sidecar", command: "node", args: ["scripts/build-indexer-sidecar.mjs"] },
      { name: "tauri-binary", command: "pnpm", args: ["tauri", "build", "--no-bundle"] },
    ]);
  });

  it("labels and bounds individual packaging steps", () => {
    const step = { name: "tauri-binary", command: "pnpm", args: ["tauri", "build"] };

    expect(packagingStepTimeoutMs(undefined)).toBe(1_200_000);
    expect(formatPackagingStepStart(step, 1_200_000)).toContain("tauri-binary");
    expect(formatPackagingStepEnd(step, 1_250)).toContain("1.3s");
    expect(() => packagingStepTimeoutMs("0")).toThrow("positive number");
  });

  it("retries only a retry-enabled packaging step with bounded backoff", () => {
    const statuses = [1, 0];
    let spawnCount = 0;
    const sleepCalls: number[] = [];
    const spawn = () => {
      spawnCount += 1;
      return { status: statuses.shift() };
    };
    const sleep = (delayMs: number) => sleepCalls.push(delayMs);
    const step = {
      name: "tauri-installer",
      command: "pnpm",
      args: ["tauri", "bundle", "--bundles", "nsis"],
      maxAttempts: 3,
      retryDelayMs: 10_000,
    };

    expect(runStepWithRetry(step, 1_200_000, () => 0, spawn, sleep)).toBe(0);
    expect(spawnCount).toBe(2);
    expect(sleepCalls).toEqual([10_000]);
  });

  it("does not retry ordinary deterministic packaging steps", () => {
    let spawnCount = 0;
    const sleepCalls: number[] = [];
    const spawn = () => {
      spawnCount += 1;
      return { status: 1 };
    };
    const sleep = (delayMs: number) => sleepCalls.push(delayMs);

    expect(runStepWithRetry(
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      1_200_000,
      () => 0,
      spawn,
      sleep,
    )).toBe(1);
    expect(spawnCount).toBe(1);
    expect(sleepCalls).toEqual([]);
  });

  it("builds the Windows portable flow as a cross-compiled exe on macOS", () => {
    expect(buildPackagingSteps({ target: "windows-portable", hostPlatform: "darwin" })).toEqual([
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      {
        name: "semantic-sidecar",
        command: "node",
        args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      {
        name: "indexer-sidecar",
        command: "node",
        args: ["scripts/build-indexer-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc", "--runner", "cargo-xwin"],
      },
      {
        name: "tauri-binary",
        command: "pnpm",
        args: ["tauri", "build", "--runner", "cargo-xwin", "--target", "x86_64-pc-windows-msvc", "--no-bundle"],
      },
      { name: "stage-portable", command: "node", args: ["scripts/stage-windows-portable.mjs"] },
    ]);
  });

  it("cross-compiles the installer packaging flow on macOS", () => {
    expect(buildPackagingSteps({ target: "windows-installer", hostPlatform: "darwin" })).toEqual([
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      {
        name: "semantic-sidecar",
        command: "node",
        args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      {
        name: "indexer-sidecar",
        command: "node",
        args: ["scripts/build-indexer-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc", "--runner", "cargo-xwin"],
      },
      {
        name: "tauri-binary",
        command: "pnpm",
        args: ["tauri", "build", "--runner", "cargo-xwin", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis"],
      },
    ]);
  });

  it("builds the installer packaging flow natively on Windows", () => {
    expect(buildPackagingSteps({ target: "windows-installer", hostPlatform: "win32" })).toEqual([
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      {
        name: "semantic-sidecar",
        command: "node",
        args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      {
        name: "indexer-sidecar",
        command: "node",
        args: ["scripts/build-indexer-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      { name: "tauri-binary", command: "pnpm", args: ["tauri", "build", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis"] },
    ]);
  });

  it("builds the portable Windows flow natively with an explicit MSVC target", () => {
    expect(buildPackagingSteps({ target: "windows-portable", hostPlatform: "win32" })).toEqual([
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      {
        name: "semantic-sidecar",
        command: "node",
        args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      {
        name: "indexer-sidecar",
        command: "node",
        args: ["scripts/build-indexer-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      { name: "tauri-binary", command: "pnpm", args: ["tauri", "build", "--target", "x86_64-pc-windows-msvc", "--no-bundle"] },
      { name: "stage-portable", command: "node", args: ["scripts/stage-windows-portable.mjs"] },
    ]);
  });

  it("builds one Windows binary before packaging both candidate formats", () => {
    expect(buildPackagingSteps({ target: "windows-candidate", hostPlatform: "win32" })).toEqual([
      { name: "frontend-build", command: "pnpm", args: ["build"] },
      {
        name: "semantic-sidecar",
        command: "node",
        args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      {
        name: "indexer-sidecar",
        command: "node",
        args: ["scripts/build-indexer-sidecar.mjs", "--target-triple", "x86_64-pc-windows-msvc"],
      },
      { name: "tauri-binary", command: "pnpm", args: ["tauri", "build", "--target", "x86_64-pc-windows-msvc", "--no-bundle"] },
      { name: "stage-portable", command: "node", args: ["scripts/stage-windows-portable.mjs"] },
      {
        name: "tauri-installer",
        command: "pnpm",
        args: ["tauri", "bundle", "--target", "x86_64-pc-windows-msvc", "--bundles", "nsis"],
        maxAttempts: 3,
        retryDelayMs: 10_000,
      },
    ]);
  });

  it("uses the Windows pnpm shim on Windows", () => {
    expect(resolvePnpmExecutable("win32")).toBe("pnpm.cmd");
  });

  it("uses the standard pnpm executable on non-Windows hosts", () => {
    expect(resolvePnpmExecutable("darwin")).toBe("pnpm");
    expect(resolvePnpmExecutable("linux")).toBe("pnpm");
  });

  it("runs Windows command shims through the system command processor", () => {
    expect(packagingSpawnOptions("win32")).toEqual({
      stdio: "inherit",
      shell: true,
    });
    expect(packagingSpawnOptions("darwin")).toEqual({
      stdio: "inherit",
      shell: false,
    });
  });

  it("reports the portable Windows archive on Windows hosts", () => {
    expect(getOutputSummary({ target: "windows-portable", platform: "win32" })).toContain("dist/ArkLine-windows-x64.zip");
  });

  it("reports the portable archive on macOS cross-builds", () => {
    expect(getOutputSummary({ target: "windows-portable", platform: "darwin" })).toContain(
      "dist/ArkLine-windows-x64.zip",
    );
  });

  it("reports the native mac binary path for mac packaging", () => {
    expect(getOutputSummary({ target: "mac", platform: "darwin" })).toContain("src-tauri/target/release/arkline");
  });

  it("stages the app and sidecar under the names expected by Tauri Shell", () => {
    const paths = portableBundlePaths("/repo");

    expect(paths.appSource).toContain("x86_64-pc-windows-msvc/release/arkline.exe");
    expect(paths.sidecarSource).toContain("arkline-semantic-x86_64-pc-windows-msvc.exe");
    expect(paths.appTarget).toContain("ArkLine-windows-x64/ArkLine.exe");
    expect(paths.sidecarTarget).toContain("ArkLine-windows-x64/arkline-semantic.exe");
    expect(paths.indexerSource).toContain("arkline-indexer-x86_64-pc-windows-msvc.exe");
    expect(paths.indexerTarget).toContain("ArkLine-windows-x64/arkline-indexer.exe");
  });
});
