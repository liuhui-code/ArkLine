#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { testTauriConfig } from "./test-rust.mjs";

const MANIFEST_PATH = "src-tauri/Cargo.toml";
const DEFAULT_REPORT = "artifacts/test-impact-rust.json";

export function planSelectedRustTests(testPaths) {
  const unitPaths = [...new Set(testPaths)]
    .filter((testPath) => testPath.startsWith("src-tauri/src/"))
    .sort();
  const integrationPaths = [...new Set(testPaths)]
    .filter((testPath) => testPath.startsWith("src-tauri/tests/"))
    .sort();
  const integrationGroups = groupIntegrationPaths(integrationPaths);
  const targets = [];

  if (unitPaths.length > 0) {
    targets.push({
      kind: "lib",
      name: "arkline_lib",
      filters: groupedUnitFilters(unitPaths),
      testPaths: unitPaths,
    });
  }

  for (const [name, targetPaths] of integrationGroups) {
    const wholeTargetSelected = targetPaths.includes(
      `src-tauri/tests/${name}.rs`,
    );
    targets.push({
      kind: "test",
      name,
      filters: wholeTargetSelected
        ? []
        : targetPaths.map(integrationModuleFilter).filter(Boolean),
      testPaths: targetPaths,
    });
  }

  return {
    schemaVersion: 1,
    cargoArgs: [
      "test",
      "--manifest-path",
      MANIFEST_PATH,
      "--no-run",
      "--message-format=json-render-diagnostics",
      ...(unitPaths.length > 0 ? ["--lib"] : []),
      ...[...integrationGroups.keys()].flatMap((name) => ["--test", name]),
    ],
    targets,
  };
}

function groupIntegrationPaths(integrationPaths) {
  const groups = new Map();
  for (const testPath of integrationPaths) {
    const stem = testPath
      .replace(/^src-tauri\/tests\//u, "")
      .replace(/\.rs$/u, "");
    const targetName = stem.startsWith("indexer_sidecar_")
      ? "indexer_sidecar"
      : stem;
    const paths = groups.get(targetName) ?? [];
    paths.push(testPath);
    groups.set(targetName, paths);
  }
  return groups;
}

export async function executeSelectedRustTests(plan, { compile, runBinary }) {
  const startedAt = new Date().toISOString();
  const artifacts = await compile(plan.cargoArgs);
  const results = [];

  for (const target of plan.targets) {
    const executable = findTestExecutable(artifacts, target);
    const filters = target.filters.length > 0 ? target.filters : [null];
    for (const filter of filters) {
      const args = [...(filter ? [filter] : []), "--test-threads=1"];
      const result = executable
        ? await runBinary(executable, args)
        : { exitCode: 1, durationMs: 0, error: `Missing test executable: ${target.name}` };
      const zeroMatches = executable && result.executedTestCount === 0;
      results.push({
        target: target.name,
        filter,
        executable,
        ...result,
        ...(zeroMatches ? { error: "Selected Rust filter matched zero tests" } : {}),
        passed: result.exitCode === 0 && !zeroMatches,
      });
    }
  }

  const passed = results.every((result) => result.passed);
  return {
    ...plan,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    passed,
    selectedTestFileCount: plan.targets.reduce(
      (count, target) => count + target.testPaths.length,
      0,
    ),
    executedModuleCount: results.length,
    executedTestCount: results.reduce(
      (count, result) => count + (result.executedTestCount ?? 0),
      0,
    ),
    results,
  };
}

function findTestExecutable(artifacts, target) {
  return artifacts.find((artifact) => (
    artifact.reason === "compiler-artifact"
    && artifact.profile?.test === true
    && artifact.target?.name === target.name
    && typeof artifact.executable === "string"
  ))?.executable ?? null;
}

function integrationModuleFilter(testPath) {
  const stem = testPath
    .replace(/^src-tauri\/tests\/indexer_sidecar_?/u, "")
    .replace(/\.rs$/u, "");
  return stem === "" ? "" : `${stem}::`;
}

function groupedUnitFilters(testPaths) {
  const groups = testPaths.map(unitFilterGroup);
  return groups.includes(null) ? [] : [...new Set(groups)].sort();
}

function unitFilterGroup(testPath) {
  const rules = [
    [/workspace_index_/u, "workspace_index_"],
    [/indexer_/u, "indexer_"],
    [/\/build_/u, "build_"],
    [/\/git_/u, "git_"],
    [/semantic_host|\/semantic/u, "semantic"],
    [/\/language_/u, "language_"],
    [/\/terminal_/u, "terminal_"],
    [/\/device_/u, "device_"],
    [/\/workspace_/u, "workspace_"],
    [/\/platform\//u, "platform::"],
    [/\/models\//u, "models::"],
    [/\/commands\//u, "commands::"],
  ];
  return rules.find(([pattern]) => pattern.test(testPath))?.[1] ?? null;
}

export async function runSelectedRustTests({ rootPath, testPaths, reportPath = DEFAULT_REPORT }) {
  const plan = planSelectedRustTests(testPaths);
  if (plan.targets.length === 0) {
    throw new Error("No supported Rust test paths were selected");
  }
  const report = await executeSelectedRustTests(plan, {
    compile: (cargoArgs) => compileTests(rootPath, cargoArgs),
    runBinary: (executable, args) => runTestBinary(rootPath, executable, args),
  });
  const output = path.resolve(rootPath, reportPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

export function parseRustTestCount(output) {
  return [...output.matchAll(/^running (\d+) tests?$/gmu)]
    .reduce((count, match) => count + Number(match[1]), 0);
}

function compileTests(rootPath, cargoArgs) {
  const result = spawnSync("cargo", cargoArgs, {
    cwd: rootPath,
    env: { ...process.env, TAURI_CONFIG: testTauriConfig() },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error || result.status !== 0) {
    throw result.error ?? new Error(`Cargo test compilation failed with exit ${result.status}`);
  }
  const messages = result.stdout
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const message of messages) {
    const rendered = message.reason === "compiler-message"
      ? message.message?.rendered
      : null;
    if (rendered) process.stderr.write(rendered);
  }
  return messages;
}

function runTestBinary(rootPath, executable, args) {
  const startedAt = Date.now();
  const result = spawnSync(executable, args, {
    cwd: rootPath,
    env: { ...process.env, TAURI_CONFIG: testTauriConfig() },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(`[test-impact:rust] ${result.error.message}`);
  return {
    exitCode: result.error ? 1 : (result.status ?? 1),
    durationMs: Date.now() - startedAt,
    executedTestCount: parseRustTestCount(result.stdout ?? ""),
  };
}

function parseArgs(argv) {
  return Object.fromEntries(argv.filter((argument) => argument !== "--").map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const testPaths = typeof args.paths === "string"
      ? args.paths.split(",").filter(Boolean)
      : [];
    const report = await runSelectedRustTests({
      rootPath: process.cwd(),
      testPaths,
      reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
    });
    console.log(`ARKLINE_TEST_IMPACT_RUST ${JSON.stringify({
      status: report.status,
      selectedTestFileCount: report.selectedTestFileCount,
      executedModuleCount: report.executedModuleCount,
      executedTestCount: report.executedTestCount,
    })}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`[test-impact:rust] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
