import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  releaseCandidatePaths,
  writeReleaseCandidateManifest,
} from "../../scripts/release-candidate-manifest.mjs";

describe("release candidate manifest", () => {
  it("derives candidate paths from the source-controlled product version", () => {
    expect(releaseCandidatePaths("C:/repo", "0.1.32")).toEqual({
      installerPath: path.join(
        "C:/repo",
        "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/ArkLine_0.1.32_x64-setup.exe",
      ),
      portablePath: path.join("C:/repo", "dist/ArkLine-windows-x64.zip"),
      outputPath: path.join("C:/repo", "artifacts/release-candidate-manifest.json"),
    });
  });

  it("binds both Windows packages to one version and commit with SHA-256 digests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-release-candidate-"));
    try {
      const tauriRoot = path.join(root, "src-tauri");
      const installerPath = path.join(root, "ArkLine_0.1.32_x64-setup.exe");
      const portablePath = path.join(root, "ArkLine-windows-x64.zip");
      const outputPath = path.join(root, "release-candidate-manifest.json");
      await mkdir(tauriRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(root, "VERSION"), "0.1.32\n", "utf8"),
        writeFile(path.join(root, "package.json"), '{"version":"0.1.32"}\n', "utf8"),
        writeFile(path.join(tauriRoot, "Cargo.toml"), '[package]\nname = "arkline"\nversion = "0.1.32"\n', "utf8"),
        writeFile(path.join(tauriRoot, "tauri.conf.json"), '{"version":"0.1.32"}\n', "utf8"),
        writeFile(installerPath, "installer", "utf8"),
        writeFile(portablePath, "portable", "utf8"),
      ]);

      const manifest = await writeReleaseCandidateManifest({
        rootPath: root,
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        installerPath,
        portablePath,
        outputPath,
      });

      expect(manifest).toEqual({
        schemaVersion: 1,
        version: "0.1.32",
        tag: "v0.1.32",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
        artifacts: [
          {
            kind: "installer",
            name: "ArkLine_0.1.32_x64-setup.exe",
            size: 9,
            sha256: createHash("sha256").update("installer").digest("hex"),
          },
          {
            kind: "portable",
            name: "ArkLine-windows-x64.zip",
            size: 8,
            sha256: createHash("sha256").update("portable").digest("hex"),
          },
        ],
      });
      expect(JSON.parse(await readFile(outputPath, "utf8"))).toEqual(manifest);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes the default candidate manifest from the CI commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-release-candidate-cli-"));
    try {
      const tauriRoot = path.join(root, "src-tauri");
      const paths = releaseCandidatePaths(root, "0.1.32");
      await mkdir(path.dirname(paths.installerPath), { recursive: true });
      await mkdir(path.dirname(paths.portablePath), { recursive: true });
      await mkdir(tauriRoot, { recursive: true });
      await Promise.all([
        writeFile(path.join(root, "VERSION"), "0.1.32\n", "utf8"),
        writeFile(path.join(root, "package.json"), '{"version":"0.1.32"}\n', "utf8"),
        writeFile(path.join(tauriRoot, "Cargo.toml"), '[package]\nname = "arkline"\nversion = "0.1.32"\n', "utf8"),
        writeFile(path.join(tauriRoot, "tauri.conf.json"), '{"version":"0.1.32"}\n', "utf8"),
        writeFile(paths.installerPath, "installer", "utf8"),
        writeFile(paths.portablePath, "portable", "utf8"),
      ]);

      const run = spawnSync(process.execPath, [
        path.join(process.cwd(), "scripts", "release-candidate-manifest.mjs"),
      ], {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
        },
      });

      expect(run.status).toBe(0);
      expect(run.stdout).toContain("ARKLINE_RELEASE_CANDIDATE v0.1.32");
      expect(JSON.parse(await readFile(paths.outputPath, "utf8"))).toMatchObject({
        tag: "v0.1.32",
        commitSha: "0123456789abcdef0123456789abcdef01234567",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a candidate that is not bound to a full commit SHA", async () => {
    await expect(writeReleaseCandidateManifest({
      rootPath: process.cwd(),
      commitSha: "main",
      installerPath: "unused.exe",
      portablePath: "unused.zip",
      outputPath: "unused.json",
    })).rejects.toThrow("Release candidate commit must be a full SHA: main");
  });
});
