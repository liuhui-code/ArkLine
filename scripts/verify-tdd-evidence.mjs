#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildTestInventory } from "./test-inventory.mjs";

const REQUIRED_TDD_FIELDS = [
  "Capability ID",
  "User-observable behavior",
  "Acceptance criteria",
  "RED evidence (failing test and parent revision)",
  "GREEN evidence (passing focused command)",
  "Refactor/full-gate evidence",
];
const REQUIRED_EXCEPTION_FIELDS = ["Reason", "Affected scope", "Owner", "Expiry"];

function fieldValue(body, label) {
  const prefix = `- ${label}:`;
  const line = body.split(/\r?\n/u).find((candidate) => candidate.startsWith(prefix));
  return line?.slice(prefix.length).trim() ?? "";
}

function isProtectedProductionPath(filePath) {
  return [
    "src/",
    "src-tauri/",
    "semantic-worker/",
    "scripts/",
    ".github/",
    "docs/quality/",
  ].some((prefix) => filePath.startsWith(prefix))
    || [
      "AGENTS.md",
      "package.json",
      "pnpm-lock.yaml",
      "vite.config.ts",
      "vitest.config.ts",
    ].includes(filePath)
    || /^tsconfig(?:\.[^.]+)?\.json$/u.test(filePath);
}

function isConventionalTestPath(filePath) {
  return filePath.startsWith("tests/")
    || filePath.startsWith("src-tauri/tests/")
    || filePath.includes("/__tests__/")
    || /(?:^|\/)[^/]+(?:\.test\.[^/]+|_tests\.rs)$/u.test(filePath);
}

export function classifyChangedTestFiles({ changedFiles, inventory }) {
  const knownTests = new Set(inventory.tests.map((test) => test.path));
  return changedFiles.filter((filePath) => knownTests.has(filePath));
}

function isDocumentationPath(filePath) {
  return filePath === "README.md"
    || filePath === "CHANGELOG.md"
    || (filePath.startsWith("docs/") && filePath.endsWith(".md"));
}

function isGeneratedPath(filePath) {
  return filePath === "pnpm-lock.yaml"
    || filePath === "src-tauri/Cargo.lock"
    || filePath.startsWith("src-tauri/gen/schemas/");
}

function isExceptionEligiblePath(filePath) {
  return isDocumentationPath(filePath) || isGeneratedPath(filePath);
}

export function validateTddEvidence({
  changedFiles,
  changedTestFiles,
  knownCapabilityIds,
  pullRequestBody,
  today = new Date().toISOString().slice(0, 10),
}) {
  const suppliedExceptionFields = REQUIRED_EXCEPTION_FIELDS.filter((label) => (
    fieldValue(pullRequestBody, label).length > 0
  ));
  const completeException = REQUIRED_EXCEPTION_FIELDS.every((label) => (
    fieldValue(pullRequestBody, label).length > 0
  ));
  if (suppliedExceptionFields.length > 0 && !completeException) {
    return {
      ok: false,
      mode: "exception",
      errors: REQUIRED_EXCEPTION_FIELDS
        .filter((label) => !suppliedExceptionFields.includes(label))
        .map((label) => `Missing required TDD exception field: ${label}`),
    };
  }
  const expiry = fieldValue(pullRequestBody, "Expiry");
  if (completeException && (!/^\d{4}-\d{2}-\d{2}$/u.test(expiry) || expiry <= today)) {
    return {
      ok: false,
      mode: "exception",
      errors: ["TDD exception expiry must be a future YYYY-MM-DD date"],
    };
  }
  if (completeException && changedFiles.every(isExceptionEligiblePath)) {
    return { ok: true, mode: "exception", errors: [] };
  }
  if (completeException) {
    return {
      ok: false,
      mode: "exception",
      errors: [
        "TDD exceptions are limited to documentation-only or mechanically generated changes",
      ],
    };
  }
  const errors = REQUIRED_TDD_FIELDS
    .filter((label) => !fieldValue(pullRequestBody, label))
    .map((label) => `Missing required TDD field: ${label}`);
  const capabilityId = fieldValue(pullRequestBody, "Capability ID");
  if (
    capabilityId
    && knownCapabilityIds
    && !knownCapabilityIds.includes(capabilityId)
  ) {
    errors.push(`Unknown capability ID: ${capabilityId}`);
  }
  const hasProductionChange = changedFiles.some(isProtectedProductionPath);
  const effectiveTestFiles = changedTestFiles
    ?? changedFiles.filter(isConventionalTestPath);
  if (hasProductionChange && effectiveTestFiles.length === 0) {
    errors.push(
      "Production changes require at least one changed executable test contract",
    );
  }
  return { ok: errors.length === 0, mode: "tdd", errors };
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

function changedFilesFromGit(rootPath, base, head) {
  const revisions = base && head ? [base, head] : ["HEAD"];
  return execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", ...revisions, "--"],
    { cwd: rootPath, encoding: "utf8" },
  )
    .split(/\r?\n/u)
    .map((filePath) => filePath.trim())
    .filter(Boolean);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootPath = process.cwd();
  const changedFiles = typeof args.files === "string"
    ? args.files.split(",").filter(Boolean)
    : changedFilesFromGit(
      rootPath,
      typeof args.base === "string" ? args.base : undefined,
      typeof args.head === "string" ? args.head : undefined,
    );
  const inventory = await buildTestInventory({ rootPath });
  const registry = JSON.parse(
    await readFile("docs/quality/capabilities.json", "utf8"),
  );
  const result = validateTddEvidence({
    changedFiles,
    changedTestFiles: classifyChangedTestFiles({ changedFiles, inventory }),
    knownCapabilityIds: registry.capabilities.map((capability) => capability.id),
    pullRequestBody: process.env.ARKLINE_PR_BODY ?? "",
  });
  console.log(`ARKLINE_TDD_EVIDENCE ${JSON.stringify(result)}`);
  if (!result.ok) process.exitCode = 1;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
