#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildTestInventory } from "./test-inventory.mjs";
import { matchesPath, normalizePath } from "./test-foundation-model.mjs";

const DEFAULT_REGISTRY = "docs/quality/capabilities.json";
const DEFAULT_REPORT = "artifacts/test-impact-shadow.json";

export function planTestImpact({
  changedFiles,
  registry,
  inventory,
  previousFailures = [],
  selectionFailure = null,
}) {
  const normalizedChanges = changedFiles.map(normalizePath);
  const globalChanges = normalizedChanges.filter((filePath) => (
    registry.globalFallbackPatterns.some((pattern) => matchesPath(filePath, pattern))
  ));
  const knownTestPaths = new Set(inventory.tests.map((test) => test.path));
  const unmappedProductionChanges = normalizedChanges.filter((filePath) => (
    isProductionPath(filePath)
    && !globalChanges.includes(filePath)
    && !knownTestPaths.has(filePath)
    && !registry.capabilities.some((capability) => (
      capability.sourcePatterns.some((pattern) => matchesPath(filePath, pattern))
    ))
  ));
  const impactedCapabilities = registry.capabilities
    .filter((capability) => normalizedChanges.some((filePath) => (
      capability.sourcePatterns.some((pattern) => matchesPath(filePath, pattern))
    )))
    .map((capability) => capability.id)
    .sort();
  const impacted = new Set(impactedCapabilities);
  const selectedTests = new Set([
    ...registry.alwaysRunTests,
    ...previousFailures,
    ...normalizedChanges.filter((filePath) => knownTestPaths.has(filePath)),
  ]);

  if (selectionFailure) {
    return {
      schemaVersion: 1,
      mode: "shadow",
      fallbackToFull: true,
      fallbackReasons: [selectionFailure],
      changedFiles: normalizedChanges.sort(),
      impactedCapabilities,
      selectedTests: inventory.tests.map((test) => test.path).sort(),
    };
  }

  if (globalChanges.length > 0 || unmappedProductionChanges.length > 0) {
    return {
      schemaVersion: 1,
      mode: "shadow",
      fallbackToFull: true,
      fallbackReasons: [
        ...globalChanges.map((filePath) => `global-contract:${filePath}`),
        ...unmappedProductionChanges.map((filePath) => `unmapped-production:${filePath}`),
      ],
      changedFiles: normalizedChanges.sort(),
      impactedCapabilities,
      selectedTests: inventory.tests.map((test) => test.path).sort(),
    };
  }

  for (const test of inventory.tests) {
    const selectedByCapability = registry.capabilities.some((capability) => (
      impacted.has(capability.id)
      && capability.testPatterns.some((pattern) => matchesPath(test.path, pattern))
    ));
    if (selectedByCapability) selectedTests.add(test.path);
  }

  return {
    schemaVersion: 1,
    mode: "shadow",
    fallbackToFull: false,
    fallbackReasons: [],
    changedFiles: normalizedChanges.sort(),
    impactedCapabilities,
    selectedTests: [...selectedTests].sort(),
  };
}

export async function buildTestImpactReport({
  rootPath,
  changedFiles,
  previousFailures = [],
  selectionFailure = null,
  registryPath = DEFAULT_REGISTRY,
}) {
  const root = path.resolve(rootPath);
  const registry = JSON.parse(await readFile(path.resolve(root, registryPath), "utf8"));
  const inventory = await buildTestInventory({ rootPath: root, registryPath });
  const plan = planTestImpact({
    changedFiles,
    previousFailures,
    selectionFailure,
    registry,
    inventory,
  });
  const selected = new Set(plan.selectedTests);
  const selectedByRunner = {};
  for (const test of inventory.tests) {
    if (!selected.has(test.path)) continue;
    selectedByRunner[test.runner] ??= [];
    selectedByRunner[test.runner].push(test.path);
  }
  return {
    ...plan,
    generatedAt: new Date().toISOString(),
    inventorySummary: inventory.summary,
    selectedByRunner,
    selectionRate: inventory.tests.length === 0
      ? 1
      : plan.selectedTests.length / inventory.tests.length,
  };
}

export async function writeTestImpactReport(options) {
  const report = await buildTestImpactReport(options);
  const output = path.resolve(options.rootPath, options.reportPath ?? DEFAULT_REPORT);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function isProductionPath(filePath) {
  return ["src/", "src-tauri/src/", "semantic-worker/src/", "scripts/"]
    .some((prefix) => filePath.startsWith(prefix));
}

function changedFilesFromGit(rootPath, base, head) {
  const revisions = base && head ? [base, head] : ["HEAD"];
  const output = execFileSync(
    "git",
    ["diff", "--name-only", "--diff-filter=ACMR", ...revisions, "--"],
    { cwd: rootPath, encoding: "utf8" },
  );
  return output.split(/\r?\n/u).map((filePath) => filePath.trim()).filter(Boolean);
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootPath = process.cwd();
  let changedFiles = [];
  let selectionFailure = null;
  try {
    changedFiles = typeof args.files === "string"
      ? args.files.split(",").filter(Boolean)
      : changedFilesFromGit(
        rootPath,
        typeof args.base === "string" ? args.base : undefined,
        typeof args.head === "string" ? args.head : undefined,
      );
  } catch (error) {
    selectionFailure = "diff-unavailable";
    console.warn(`[test-impact] changed-file diff unavailable; selecting full suite: ${error instanceof Error ? error.message : String(error)}`);
  }
  const report = await writeTestImpactReport({
    rootPath,
    changedFiles,
    selectionFailure,
    previousFailures: typeof args.failures === "string"
      ? args.failures.split(",").filter(Boolean)
      : [],
    registryPath: typeof args.registry === "string" ? args.registry : DEFAULT_REGISTRY,
    reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
  });
  console.log(`ARKLINE_TEST_IMPACT ${JSON.stringify({
    fallbackToFull: report.fallbackToFull,
    impactedCapabilities: report.impactedCapabilities,
    selectedTestCount: report.selectedTests.length,
  })}`);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
