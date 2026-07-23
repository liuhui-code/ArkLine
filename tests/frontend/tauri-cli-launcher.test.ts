import { describe, expect, it } from "vitest";

// Runtime launcher script imported for regression coverage.
// @ts-ignore The launcher is a Node ESM script, not a typed app module.
import {
  buildTauriArgs,
  resolveTauriExecutable,
  tauriSpawnOptions,
} from "../../scripts/tauri-cli.mjs";

describe("tauri cli launcher", () => {
  it("injects the MSVC target for tauri dev on Windows", () => {
    expect(buildTauriArgs(["dev"], "win32")).toEqual([
      "dev",
      "--target",
      "x86_64-pc-windows-msvc",
    ]);
  });

  it("injects the MSVC target for tauri build on Windows", () => {
    expect(buildTauriArgs(["build", "--bundles", "nsis"], "win32")).toEqual([
      "build",
      "--target",
      "x86_64-pc-windows-msvc",
      "--bundles",
      "nsis",
    ]);
  });

  it("does not override an explicit target", () => {
    expect(buildTauriArgs(["dev", "--target", "aarch64-pc-windows-msvc"], "win32")).toEqual([
      "dev",
      "--target",
      "aarch64-pc-windows-msvc",
    ]);
    expect(buildTauriArgs(["build", "-t", "x86_64-pc-windows-gnu"], "win32")).toEqual([
      "build",
      "-t",
      "x86_64-pc-windows-gnu",
    ]);
  });

  it("leaves non-Windows hosts unchanged", () => {
    expect(buildTauriArgs(["dev"], "darwin")).toEqual(["dev"]);
    expect(buildTauriArgs(["build", "--bundles", "nsis"], "linux")).toEqual(["build", "--bundles", "nsis"]);
  });

  it("uses the Windows tauri shim on Windows", () => {
    expect(resolveTauriExecutable("win32")).toBe("tauri.cmd");
  });

  it("runs the Windows tauri shim through the system command processor", () => {
    expect(tauriSpawnOptions("win32")).toEqual({
      stdio: "inherit",
      shell: true,
    });
    expect(tauriSpawnOptions("linux")).toEqual({
      stdio: "inherit",
      shell: false,
    });
  });
});
