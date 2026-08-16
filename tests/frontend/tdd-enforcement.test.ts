import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  classifyChangedTestFiles,
  validateTddEvidence,
} from "../../scripts/verify-tdd-evidence.mjs";

const COMPLETE_TDD_EVIDENCE = `
## Capability / acceptance criteria

- Capability ID: verified-windows-release
- User-observable behavior: Pull requests cannot merge without executable TDD evidence.
- Acceptance criteria: A production change with a regression test and RED/GREEN commands is accepted.

## TDD evidence

- RED evidence (failing test and parent revision): pnpm exec vitest run tests/frontend/tdd-enforcement.test.ts failed on parent f4c12db0
- GREEN evidence (passing focused command): pnpm exec vitest run tests/frontend/tdd-enforcement.test.ts passed
- Refactor/full-gate evidence: pnpm check:fast passed

## TDD exception

- Reason:
- Affected scope:
- Owner:
- Expiry:
`;

const DOCUMENTATION_EXCEPTION = `
## TDD exception

- Reason: Correct documentation wording without changing executable behavior.
- Affected scope: docs/quality/tdd-policy.md
- Owner: quality-platform
- Expiry: 2026-08-31
`;

describe("TDD evidence enforcement", () => {
  it("accepts a production change backed by a changed test and complete RED/GREEN evidence", () => {
    const result = validateTddEvidence({
      changedFiles: [
        "scripts/verify-tdd-evidence.mjs",
        "tests/frontend/tdd-enforcement.test.ts",
      ],
      pullRequestBody: COMPLETE_TDD_EVIDENCE,
    });

    expect(result).toEqual({ ok: true, mode: "tdd", errors: [] });
  });

  it("rejects a production change when required TDD evidence is missing", () => {
    const result = validateTddEvidence({
      changedFiles: [
        "src/features/build/build-service.ts",
        "tests/frontend/build-service.test.ts",
      ],
      pullRequestBody: COMPLETE_TDD_EVIDENCE.replace(
        "pnpm exec vitest run tests/frontend/tdd-enforcement.test.ts failed on parent f4c12db0",
        "",
      ),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Missing required TDD field: RED evidence (failing test and parent revision)",
    );
  });

  it("rejects a capability ID that is absent from the capability registry", () => {
    const result = validateTddEvidence({
      changedFiles: [
        "scripts/verify-tdd-evidence.mjs",
        "tests/frontend/tdd-enforcement.test.ts",
      ],
      knownCapabilityIds: ["verified-windows-release"],
      pullRequestBody: COMPLETE_TDD_EVIDENCE.replace(
        "verified-windows-release",
        "project-wide-tdd",
      ),
    });

    expect(result.errors).toContain("Unknown capability ID: project-wide-tdd");
  });

  it.each([
    ["Capability ID", "verified-windows-release"],
    [
      "User-observable behavior",
      "Pull requests cannot merge without executable TDD evidence.",
    ],
    [
      "Acceptance criteria",
      "A production change with a regression test and RED/GREEN commands is accepted.",
    ],
    [
      "GREEN evidence (passing focused command)",
      "pnpm exec vitest run tests/frontend/tdd-enforcement.test.ts passed",
    ],
    ["Refactor/full-gate evidence", "pnpm check:fast passed"],
  ])("requires the %s field", (label, value) => {
    const result = validateTddEvidence({
      changedFiles: [
        "scripts/verify-tdd-evidence.mjs",
        "tests/frontend/tdd-enforcement.test.ts",
      ],
      pullRequestBody: COMPLETE_TDD_EVIDENCE.replace(value, ""),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(`Missing required TDD field: ${label}`);
  });

  it("rejects production changes without a changed executable test contract", () => {
    const result = validateTddEvidence({
      changedFiles: ["src/features/build/build-service.ts"],
      changedTestFiles: [],
      pullRequestBody: COMPLETE_TDD_EVIDENCE,
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain(
      "Production changes require at least one changed executable test contract",
    );
  });

  it.each([
    "vite.config.ts",
    "vitest.config.ts",
    "tsconfig.app.json",
    ".github/workflows/windows-ci.yml",
    "src-tauri/Cargo.toml",
    "src-tauri/tauri.conf.json",
    "semantic-worker/package.json",
  ])("treats executable configuration %s as a production change", (filePath) => {
    const result = validateTddEvidence({
      changedFiles: [filePath],
      changedTestFiles: [],
      pullRequestBody: COMPLETE_TDD_EVIDENCE,
    });

    expect(result.errors).toContain(
      "Production changes require at least one changed executable test contract",
    );
  });

  it("accepts an owned and expiring exception for documentation-only changes", () => {
    const result = validateTddEvidence({
      changedFiles: ["docs/quality/tdd-policy.md"],
      changedTestFiles: [],
      pullRequestBody: DOCUMENTATION_EXCEPTION,
    });

    expect(result).toEqual({ ok: true, mode: "exception", errors: [] });
  });

  it.each([
    "pnpm-lock.yaml",
    "src-tauri/Cargo.lock",
    "src-tauri/gen/schemas/desktop-schema.json",
  ])("accepts an explicit exception for the generated file %s", (filePath) => {
    const result = validateTddEvidence({
      changedFiles: [filePath],
      changedTestFiles: [],
      pullRequestBody: DOCUMENTATION_EXCEPTION.replace(
        "docs/quality/tdd-policy.md",
        filePath,
      ),
    });

    expect(result).toEqual({ ok: true, mode: "exception", errors: [] });
  });

  it("rejects a TDD exception that includes production code", () => {
    const result = validateTddEvidence({
      changedFiles: [
        "docs/quality/tdd-policy.md",
        "src/features/build/build-service.ts",
      ],
      changedTestFiles: [],
      pullRequestBody: DOCUMENTATION_EXCEPTION,
    });

    expect(result).toEqual({
      ok: false,
      mode: "exception",
      errors: [
        "TDD exceptions are limited to documentation-only or mechanically generated changes",
      ],
    });
  });

  it("rejects an expired TDD exception", () => {
    const result = validateTddEvidence({
      changedFiles: ["docs/quality/tdd-policy.md"],
      changedTestFiles: [],
      pullRequestBody: DOCUMENTATION_EXCEPTION.replace(
        "2026-08-31",
        "2026-08-15",
      ),
      today: "2026-08-16",
    });

    expect(result).toEqual({
      ok: false,
      mode: "exception",
      errors: ["TDD exception expiry must be a future YYYY-MM-DD date"],
    });
  });

  it("rejects a partial TDD exception with explicit missing fields", () => {
    const result = validateTddEvidence({
      changedFiles: ["docs/quality/tdd-policy.md"],
      changedTestFiles: [],
      pullRequestBody: DOCUMENTATION_EXCEPTION
        .replace("docs/quality/tdd-policy.md", "")
        .replace("quality-platform", "")
        .replace("2026-08-31", ""),
    });

    expect(result).toEqual({
      ok: false,
      mode: "exception",
      errors: [
        "Missing required TDD exception field: Affected scope",
        "Missing required TDD exception field: Owner",
        "Missing required TDD exception field: Expiry",
      ],
    });
  });

  it("recognizes changed Rust files containing inline tests through the test inventory", () => {
    const changedTestFiles = classifyChangedTestFiles({
      changedFiles: [
        "src-tauri/src/services/build_service.rs",
        "src-tauri/src/services/workspace_index_connection_service.rs",
      ],
      inventory: {
        tests: [
          { path: "src-tauri/src/services/workspace_index_connection_service.rs" },
        ],
      },
    });

    expect(changedTestFiles).toEqual([
      "src-tauri/src/services/workspace_index_connection_service.rs",
    ]);
  });

  it("provides a CI command that emits machine-readable passing evidence", () => {
    const run = spawnSync(
      process.execPath,
      [
        "scripts/verify-tdd-evidence.mjs",
        "--files=scripts/verify-tdd-evidence.mjs,tests/frontend/tdd-enforcement.test.ts",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ARKLINE_PR_BODY: COMPLETE_TDD_EVIDENCE,
        },
      },
    );

    expect(run.status).toBe(0);
    expect(run.stdout).toContain(
      'ARKLINE_TDD_EVIDENCE {"ok":true,"mode":"tdd","errors":[]}',
    );
  });

  it("returns a blocking exit code when CI evidence is invalid", () => {
    const run = spawnSync(
      process.execPath,
      [
        "scripts/verify-tdd-evidence.mjs",
        "--files=scripts/verify-tdd-evidence.mjs,tests/frontend/tdd-enforcement.test.ts",
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ARKLINE_PR_BODY: COMPLETE_TDD_EVIDENCE.replace(
            "pnpm exec vitest run tests/frontend/tdd-enforcement.test.ts failed on parent f4c12db0",
            "",
          ),
        },
      },
    );

    expect(run.status).toBe(1);
    expect(run.stdout).toContain('ARKLINE_TDD_EVIDENCE {"ok":false');
  });
});
