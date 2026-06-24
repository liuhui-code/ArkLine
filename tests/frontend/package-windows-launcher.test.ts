import { describe, expect, it } from "vitest";

// Runtime packaging script imported for regression coverage.
// @ts-ignore The launcher is a Node ESM script, not a typed app module.
import {
  buildPackagingSteps,
  getOutputSummary,
  resolvePnpmExecutable,
} from "../../scripts/package-windows.mjs";

describe("package windows launcher", () => {
  it("builds the mac packaging flow as a native no-bundle binary", () => {
    expect(buildPackagingSteps({ target: "mac", hostPlatform: "darwin" })).toEqual([
      { command: "pnpm", args: ["build"] },
      { command: "pnpm", args: ["tauri", "build", "--no-bundle"] },
    ]);
  });

  it("builds the Windows portable flow as a cross-compiled exe on macOS", () => {
    expect(buildPackagingSteps({ target: "windows-portable", hostPlatform: "darwin" })).toEqual([
      { command: "pnpm", args: ["build"] },
      {
        command: "pnpm",
        args: ["tauri", "build", "--runner", "cargo-xwin", "--target", "x86_64-pc-windows-msvc", "--no-bundle"],
      },
    ]);
  });

  it("builds the installer packaging flow without a PowerShell dependency", () => {
    expect(buildPackagingSteps({ target: "windows-installer", hostPlatform: "darwin" })).toEqual([
      { command: "pnpm", args: ["build"] },
      { command: "pnpm", args: ["tauri", "build", "--bundles", "nsis"] },
    ]);
  });

  it("uses the Windows pnpm shim on Windows", () => {
    expect(resolvePnpmExecutable("win32")).toBe("pnpm.cmd");
  });

  it("uses the standard pnpm executable on non-Windows hosts", () => {
    expect(resolvePnpmExecutable("darwin")).toBe("pnpm");
    expect(resolvePnpmExecutable("linux")).toBe("pnpm");
  });

  it("reports the portable Windows executable path on Windows hosts", () => {
    expect(getOutputSummary({ target: "windows-portable", platform: "win32" })).toContain("src-tauri/target/release/arkline.exe");
  });

  it("reports the cross-compiled Windows exe path on macOS for portable builds", () => {
    expect(getOutputSummary({ target: "windows-portable", platform: "darwin" })).toContain(
      "src-tauri/target/x86_64-pc-windows-msvc/release/arkline.exe",
    );
  });

  it("reports the native mac binary path for mac packaging", () => {
    expect(getOutputSummary({ target: "mac", platform: "darwin" })).toContain("src-tauri/target/release/arkline");
  });
});
