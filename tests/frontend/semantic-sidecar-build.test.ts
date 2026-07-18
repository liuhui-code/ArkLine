import path from "node:path";

import { describe, expect, it } from "vitest";

// @ts-ignore Node ESM build utility intentionally has no declaration file.
import {
  resolvePkgTarget,
  semanticSidecarOutput,
} from "../../scripts/build-semantic-sidecar.mjs";
// @ts-ignore Node ESM build utility intentionally has no declaration file.
import {
  buildIndexerCommand,
  indexerBuildArtifact,
  indexerSidecarOutput,
} from "../../scripts/build-indexer-sidecar.mjs";

describe("semantic sidecar build targets", () => {
  it("maps the supported Windows target to a standalone Node executable", () => {
    expect(resolvePkgTarget("x86_64-pc-windows-msvc")).toBe("node24-win-x64");
    expect(semanticSidecarOutput("x86_64-pc-windows-msvc", "/repo")).toBe(
      path.join("/repo", "src-tauri", "binaries", "arkline-semantic-x86_64-pc-windows-msvc.exe"),
    );
  });

  it("maps native Apple Silicon and Intel targets", () => {
    expect(resolvePkgTarget("aarch64-apple-darwin")).toBe("node24-macos-arm64");
    expect(resolvePkgTarget("x86_64-apple-darwin")).toBe("node24-macos-x64");
  });

  it("rejects unsupported targets instead of producing a mislabeled binary", () => {
    expect(() => resolvePkgTarget("wasm32-unknown-unknown")).toThrow("Unsupported semantic sidecar target");
  });
});

describe("indexer sidecar build targets", () => {
  it("uses the Tauri target-triple externalBin name", () => {
    expect(indexerSidecarOutput("x86_64-pc-windows-msvc", "/repo")).toBe(
      path.join("/repo", "src-tauri", "binaries", "arkline-indexer-x86_64-pc-windows-msvc.exe"),
    );
    expect(indexerBuildArtifact("aarch64-apple-darwin", "/repo")).toBe(
      path.join("/repo", "src-tauri", "target", "aarch64-apple-darwin", "release", "arkline-indexer"),
    );
  });

  it("selects cargo-xwin only for an explicit cross runner", () => {
    expect(buildIndexerCommand("x86_64-pc-windows-msvc", "cargo-xwin").args.slice(0, 2))
      .toEqual(["xwin", "build"]);
    expect(buildIndexerCommand("x86_64-pc-windows-msvc", "cargo").args[0]).toBe("build");
  });
});
