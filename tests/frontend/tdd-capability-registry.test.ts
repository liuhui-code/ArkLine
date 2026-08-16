import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Capability = {
  id: string;
  domain: string;
  risk: "critical" | "high" | "normal";
  owner: string;
  behavior: string;
  sourcePatterns: string[];
  testPatterns: string[];
  testLevels: string[];
};

type CapabilityRegistry = {
  schemaVersion: number;
  coreDomains: string[];
  alwaysRunTests: string[];
  fullSuitePatterns: string[];
  globalFallbackPatterns: string[];
  capabilities: Capability[];
};

async function readRegistry() {
  return JSON.parse(
    await readFile(path.join(process.cwd(), "docs/quality/capabilities.json"), "utf8"),
  ) as CapabilityRegistry;
}

describe("TDD capability registry", () => {
  it("maps every core product domain to observable behavior and tests", async () => {
    const registry = await readRegistry();
    const registeredDomains = new Set(registry.capabilities.map((capability) => capability.domain));

    expect(registry.schemaVersion).toBe(1);
    expect(registry.coreDomains).toEqual(expect.arrayContaining([
      "build",
      "indexing",
      "git",
      "workspace",
      "editor",
      "search-navigation",
      "semantic",
      "terminal",
      "device-log",
      "release",
    ]));
    expect(registry.coreDomains.every((domain) => registeredDomains.has(domain))).toBe(true);
    expect(registry.alwaysRunTests).toEqual([
      "tests/frontend/tdd-capability-registry.test.ts",
      "tests/frontend/tdd-test-inventory.test.ts",
      "tests/frontend/tdd-test-impact.test.ts",
      "tests/frontend/tdd-rust-impact.test.ts",
      "tests/frontend/tdd-test-impact-reconciliation.test.ts",
      "tests/frontend/tdd-test-impact-history.test.ts",
      "tests/frontend/tdd-test-impact-calibration.test.ts",
      "tests/frontend/tdd-test-impact-promotion-review.test.ts",
      "tests/frontend/tdd-enforcement.test.ts",
      "tests/frontend/tdd-governance.test.ts",
    ]);
    expect(registry.fullSuitePatterns.length).toBeGreaterThan(0);
    expect(registry.globalFallbackPatterns.length).toBeGreaterThan(0);

    for (const capability of registry.capabilities) {
      expect(capability.id).toMatch(/^[a-z][a-z0-9-]+$/u);
      expect(capability.owner).not.toBe("");
      expect(capability.behavior.length).toBeGreaterThan(20);
      expect(capability.sourcePatterns.length).toBeGreaterThan(0);
      expect(capability.testPatterns.length).toBeGreaterThan(0);
      expect(capability.testLevels.length).toBeGreaterThan(0);
    }
  });

  it("treats real project build, project-open readiness, and Git workflow as critical", async () => {
    const registry = await readRegistry();
    const critical = new Map(
      registry.capabilities
        .filter((capability) => capability.risk === "critical")
        .map((capability) => [capability.id, capability]),
    );

    for (const id of ["real-project-build", "project-open-index-readiness", "git-core-workflow"]) {
      expect(critical.has(id), `${id} must remain a critical capability`).toBe(true);
      expect(critical.get(id)?.testLevels).toEqual(expect.arrayContaining(["medium", "product"]));
    }
  });
});
