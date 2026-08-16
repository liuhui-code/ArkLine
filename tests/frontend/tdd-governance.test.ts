import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function read(relativePath: string) {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("TDD governance", () => {
  it("declares project-wide TDD as mandatory for every contributor and agent", async () => {
    const agentInstructions = await read("AGENTS.md");
    const policy = await read("docs/quality/tdd-policy.md");
    const template = await read(".github/PULL_REQUEST_TEMPLATE.md");

    expect(agentInstructions).toContain("## Mandatory project-wide TDD");
    expect(agentInstructions).toContain("Do not edit production code before observing RED");
    expect(agentInstructions).toContain("One test → one minimal implementation → refactor while GREEN");
    expect(agentInstructions).toContain("Never push or merge directly to `main`");
    expect(policy).toContain("Project-wide enforcement");
    expect(policy).toContain("TDD Evidence");
    for (const field of ["Reason", "Affected scope", "Owner", "Expiry"]) {
      expect(template).toContain(`- ${field}:`);
    }
  });

  it("defines repository-wide behavior, test-size, impact, and flake policy", async () => {
    const policy = await read("docs/quality/tdd-policy.md");

    expect(policy).toContain("RED → GREEN → REFACTOR");
    expect(policy).toContain("Small / Medium / Large / Product");
    expect(policy).toContain("Mock only system boundaries");
    expect(policy).toContain("Unknown impact means full suite");
    expect(policy).toContain("owner and expiry");
  });

  it("requires pull requests to carry executable TDD evidence or an explicit exception", async () => {
    const template = await read(".github/PULL_REQUEST_TEMPLATE.md");

    for (const field of [
      "Capability / acceptance criteria",
      "RED evidence",
      "GREEN evidence",
      "Impact shadow",
      "TDD exception",
    ]) {
      expect(template).toContain(field);
    }
  });

  it("keeps discovered systemic test debt owned and time-bounded", async () => {
    const registry = JSON.parse(await read("docs/quality/test-debt.json")) as {
      schemaVersion: number;
      items: Array<{
        id: string;
        owner: string;
        targetDate: string;
        evidence: string;
        status: string;
        resolvedDate?: string;
        resolutionEvidence?: string;
      }>;
    };

    expect(registry.schemaVersion).toBe(1);
    expect(registry.items.map((item) => item.id)).toEqual(expect.arrayContaining([
      "rust-suite-file-descriptor-exhaustion",
      "frontend-app-shell-heavy-suite",
      "unmapped-capability-tests",
    ]));
    expect(registry.items.every((item) => {
      const validBase = item.owner.length > 0
        && /^\d{4}-\d{2}-\d{2}$/u.test(item.targetDate)
        && item.evidence.length > 20
        && ["open", "resolved"].includes(item.status);
      if (item.status === "open") {
        return validBase;
      }
      return validBase
        && /^\d{4}-\d{2}-\d{2}$/u.test(item.resolvedDate ?? "")
        && (item.resolutionEvidence?.length ?? 0) > 20;
    })).toBe(true);
  });

  it("runs Rust library and consolidated integration tests without zero-test binary harnesses", async () => {
    const rustRunner = await read("scripts/test-rust.mjs");
    const cargoManifest = await read("src-tauri/Cargo.toml");
    const integrationTarget = await read("src-tauri/tests/indexer_sidecar.rs");

    expect(rustRunner).toContain('"--lib"');
    expect(rustRunner).toContain('"--test", "indexer_sidecar"');
    expect(cargoManifest).toContain("autotests = false");
    expect(cargoManifest).toContain('name = "indexer_sidecar"');
    for (const moduleName of ["content_health", "equivalence", "health"]) {
      expect(integrationTarget).toContain(`mod ${moduleName};`);
    }
  });

  it("defines Stage 2 Rust execution and reconciliation without weakening the authoritative gate", async () => {
    const policy = await read("docs/quality/tdd-policy.md");
    const template = await read(".github/PULL_REQUEST_TEMPLATE.md");
    const normalizedPolicy = policy.replace(/\s+/gu, " ");

    expect(policy).toContain("Stage 2 advisory");
    expect(policy).toContain("Frontend and semantic-worker");
    expect(policy).toContain("selected Rust test groups");
    expect(policy).toContain("potential false negatives");
    expect(policy).toContain("historical aggregation");
    expect(normalizedPolicy).toContain("does not replace `pnpm check:fast`");
    expect(template).toContain("Impact advisory result");
  });

  it("defines Stage 3 identity-bearing historical promotion evidence", async () => {
    const policy = await read("docs/quality/tdd-policy.md");

    expect(policy).toContain("Stage 3 evidence");
    expect(policy).toContain("failed test identities");
    expect(policy).toContain("`sampleId`");
    expect(policy).toContain("100 production samples");
    expect(policy).toContain("5 identity-bearing failure samples");
    expect(policy).toContain("does not make the advisory blocking");
  });

  it("defines Stage 4 scheduled collection and controlled failure calibration", async () => {
    const policy = await read("docs/quality/tdd-policy.md");
    const normalizedPolicy = policy.replace(/\s+/gu, " ");

    expect(policy).toContain("Stage 4 calibration");
    expect(policy).toContain("`controlled-failure`");
    expect(policy).toContain("100 production samples");
    expect(policy).toContain("5 identity-bearing failure samples");
    expect(policy).toContain("separate scheduled workflow");
    expect(normalizedPolicy).toContain("does not block `windows-ci`");
  });

  it("defines Stage 5 promotion review without automatic enforcement", async () => {
    const policy = await read("docs/quality/tdd-policy.md");

    expect(policy).toContain("Stage 5 promotion review");
    expect(policy).toContain("`collecting`");
    expect(policy).toContain("`blocked`");
    expect(policy).toContain("`review-required`");
    expect(policy).toContain("`blockingAuthorized: false`");
    expect(policy).toContain("GitHub Actions Job Summary");
    expect(policy).toContain("never changes required checks");
  });
});
