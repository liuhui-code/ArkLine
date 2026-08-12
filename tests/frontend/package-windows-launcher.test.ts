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
