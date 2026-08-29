import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readReleaseVersion } from "../../scripts/release-version.mjs";

async function withVersionFixture(
  versions: { sourceVersion?: string; packageVersion: string; cargoVersion: string; tauriVersion: string },
  callback: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "arkline-release-version-"));
  try {
    await mkdir(path.join(root, "src-tauri"), { recursive: true });
    await Promise.all([
      writeFile(
        path.join(root, "VERSION"),
        `${versions.sourceVersion ?? versions.packageVersion}\n`,
        "utf8",
      ),
      writeFile(
        path.join(root, "package.json"),
        `${JSON.stringify({ version: versions.packageVersion }, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(root, "src-tauri", "Cargo.toml"),
        `[package]\nname = "arkline"\nversion = "${versions.cargoVersion}"\n`,
        "utf8",
      ),
      writeFile(
        path.join(root, "src-tauri", "tauri.conf.json"),
        `${JSON.stringify({ version: versions.tauriVersion }, null, 2)}\n`,
        "utf8",
      ),
    ]);
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("release version", () => {
  it("pins the next immutable GitHub release to v0.1.34", async () => {
    await expect(readReleaseVersion(process.cwd())).resolves.toBe("0.1.34");
  });

  it("returns the shared semantic version used by every release manifest", async () => {
    await withVersionFixture({
      packageVersion: "0.1.31",
      cargoVersion: "0.1.31",
      tauriVersion: "0.1.31",
    }, async (root) => {
      await expect(readReleaseVersion(root)).resolves.toBe("0.1.31");
    });
  });

  it("rejects a shared version that cannot be used as a release tag", async () => {
    await withVersionFixture({
      packageVersion: "latest",
      cargoVersion: "latest",
      tauriVersion: "latest",
    }, async (root) => {
      await expect(readReleaseVersion(root)).rejects.toThrow(
        "Release version must be semantic: latest",
      );
    });
  });

  it("rejects manifests that drift from the source-controlled release version", async () => {
    await withVersionFixture({
      sourceVersion: "0.1.32",
      packageVersion: "0.1.31",
      cargoVersion: "0.1.31",
      tauriVersion: "0.1.31",
    }, async (root) => {
      await expect(readReleaseVersion(root)).rejects.toThrow(
        "Release versions do not match: source=0.1.32, package=0.1.31, cargo=0.1.31, tauri=0.1.31",
      );
    });
  });
});
