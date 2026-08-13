import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PackageJson = {
  scripts?: Record<string, string>;
};

type QualityGateManifest = {
  gates: {
    fast: {
      command: string;
      steps: string[];
      stepTimeoutMs: number;
    };
    full: {
      command: string;
      steps: string[];
      stepTimeoutMs: number;
    };
    "release-frontend": {
      command: string;
      steps: string[];
      stepTimeoutMs: number;
    };
    "release-rust": {
      command: string;
      steps: string[];
      stepTimeoutMs: number;
    };
  };
  frontendQualityTests: string[];
};

async function readJson<T>(relativePath: string) {
  return JSON.parse(
    await readFile(path.join(process.cwd(), relativePath), "utf8"),
  ) as T;
}

describe("quality gate manifest", () => {
  it("matches package scripts for fast, full, and focused frontend gates", async () => {
    const manifest = await readJson<QualityGateManifest>(
      "docs/quality-gates.json",
    );
    const packageJson = await readJson<PackageJson>("package.json");
    const scripts = packageJson.scripts ?? {};

    expect(manifest.gates.fast.command).toBe(
      "node scripts/run-quality-gate.mjs --gate=fast --strict",
    );
    expect(manifest.gates.full.command).toBe(
      "node scripts/run-quality-gate.mjs --gate=full --strict",
    );
    expect(manifest.gates["release-frontend"].steps).not.toContain("pnpm test:rust");
    expect(manifest.gates["release-rust"].steps).toEqual(["pnpm test:rust"]);
    expect(manifest.gates.fast.stepTimeoutMs).toBe(900000);
    expect(manifest.gates.full.stepTimeoutMs).toBe(2000000);
    expect(scripts["check:fast"]).toBe(manifest.gates.fast.command);
    expect(scripts.check).toBe(manifest.gates.full.command);
    expect(scripts["check:release:frontend"]).toBe(
      manifest.gates["release-frontend"].command,
    );
    expect(scripts["check:release:rust"]).toBe(
      manifest.gates["release-rust"].command,
    );
    expect(scripts["test:frontend:quality"]).toBe(
      `vitest run ${manifest.frontendQualityTests.join(" ")}`,
    );
  });
});
