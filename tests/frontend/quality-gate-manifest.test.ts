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
    };
    full: {
      command: string;
      steps: string[];
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

    expect(manifest.gates.fast.command).toBe("pnpm check:fast");
    expect(manifest.gates.full.command).toBe("pnpm check");
    expect(scripts["check:fast"]).toBe(manifest.gates.fast.steps.join(" && "));
    expect(scripts.check).toBe(manifest.gates.full.steps.join(" && "));
    expect(scripts["test:frontend:quality"]).toBe(
      `vitest run ${manifest.frontendQualityTests.join(" ")}`,
    );
  });
});
