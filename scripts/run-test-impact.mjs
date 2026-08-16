#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { extractFailedTestIdentities } from "./run-quality-gate.mjs";

const DEFAULT_SHADOW_REPORT = "artifacts/test-impact-shadow.json";
const DEFAULT_ADVISORY_REPORT = "artifacts/test-impact-advisory.json";

export function planImpactAdvisory(impactReport) {
  const selectedByRunner = impactReport.selectedByRunner ?? {};
  const commands = [];
  const deferredByRunner = {};

  if (!impactReport.fallbackToFull) {
    const frontend = selectedByRunner.frontend ?? [];
    if (frontend.length > 0) {
      commands.push({
        runner: "frontend",
        command: "pnpm",
        args: ["exec", "vitest", "run", ...frontend],
        testPaths: frontend,
      });
    }

    const semanticWorker = selectedByRunner["semantic-worker"] ?? [];
    if (semanticWorker.length > 0) {
      commands.push({
        runner: "semantic-worker",
        command: "pnpm",
        args: [
          "--dir",
          "semantic-worker",
          "exec",
          "vitest",
          "run",
          ...semanticWorker.map((testPath) => testPath.replace(/^semantic-worker\//u, "")),
        ],
        testPaths: semanticWorker,
      });
    }

    const rust = [
      ...(selectedByRunner["rust-unit"] ?? []),
      ...(selectedByRunner["rust-integration"] ?? []),
    ];
    if (rust.length > 0) {
      commands.push({
        runner: "rust",
        command: "node",
        args: [
          "scripts/run-selected-rust-tests.mjs",
          `--paths=${rust.join(",")}`,
        ],
        testPaths: rust,
      });
    }
  }

  for (const [runner, testPaths] of Object.entries(selectedByRunner)) {
    if (
      impactReport.fallbackToFull
      || !["frontend", "semantic-worker", "rust-unit", "rust-integration"].includes(runner)
    ) {
      deferredByRunner[runner] = testPaths;
    }
  }

  return {
    schemaVersion: 1,
    mode: "advisory",
    fallbackToFull: impactReport.fallbackToFull,
    fallbackReasons: impactReport.fallbackReasons ?? [],
    selectedTestCount: impactReport.selectedTests?.length ?? 0,
    executableTestCount: commands.reduce((count, command) => count + command.testPaths.length, 0),
    deferredTestCount: Object.values(deferredByRunner)
      .reduce((count, testPaths) => count + testPaths.length, 0),
    authoritativeGate: "pnpm check:fast",
    commands,
    deferredByRunner,
  };
}

export async function executeImpactAdvisory(plan, { runCommand }) {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const command of plan.commands) {
    const result = await runCommand(command);
    results.push({
      ...command,
      ...result,
      passed: result.exitCode === 0,
    });
  }
  const failed = results.some((result) => !result.passed);
  const delegated = plan.fallbackToFull || plan.commands.length === 0;
  const status = failed
    ? "failed"
    : delegated
      ? "delegated"
      : plan.deferredTestCount > 0
        ? "passed-with-deferred"
        : "passed";
  return {
    ...plan,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
    passed: !failed,
    executedTestCount: results.reduce(
      (count, result) => count + result.testPaths.length,
      0,
    ),
    results,
  };
}

export async function runImpactAdvisory({ rootPath, argv }) {
  const args = parseArgs(argv);
  const shadowReportPath = typeof args["shadow-report"] === "string"
    ? args["shadow-report"]
    : DEFAULT_SHADOW_REPORT;
  const advisoryReportPath = typeof args["advisory-report"] === "string"
    ? args["advisory-report"]
    : DEFAULT_ADVISORY_REPORT;
  const forwardedArgs = argv.filter((argument) => (
    argument !== "--"
    && !argument.startsWith("--shadow-report=")
    && !argument.startsWith("--advisory-report=")
    && !argument.startsWith("--report=")
  ));
  const impactResult = spawnSync(
    process.execPath,
    [
      path.join(rootPath, "scripts/test-impact.mjs"),
      ...forwardedArgs,
      `--report=${shadowReportPath}`,
    ],
    { cwd: rootPath, stdio: "inherit" },
  );
  if (impactResult.error || impactResult.status !== 0) {
    throw impactResult.error ?? new Error("Impact shadow generation failed");
  }

  const impactReport = JSON.parse(
    await readFile(path.resolve(rootPath, shadowReportPath), "utf8"),
  );
  const plan = planImpactAdvisory(impactReport);
  const report = await executeImpactAdvisory(plan, {
    runCommand: (command) => runCommand(rootPath, command),
  });
  const output = path.resolve(rootPath, advisoryReportPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

function runCommand(rootPath, command) {
  const startedAt = Date.now();
  const executable = process.platform === "win32" && command.command === "pnpm"
    ? "pnpm.cmd"
    : command.command;
  const result = spawnSync(executable, command.args, {
    cwd: rootPath,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(`[test-impact:advisory] ${result.error.message}`);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const failedTests = extractFailedTestIdentities(output);
  return {
    exitCode: result.error ? 1 : (result.status ?? 1),
    durationMs: Date.now() - startedAt,
    failedTests,
    failureIdentityPrecision: failedTests.length > 0
      ? "runner-output"
      : "step-only",
  };
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

async function main() {
  try {
    const report = await runImpactAdvisory({
      rootPath: process.cwd(),
      argv: process.argv.slice(2),
    });
    console.log(`ARKLINE_TEST_IMPACT_ADVISORY ${JSON.stringify({
      status: report.status,
      passed: report.passed,
      selectedTestCount: report.selectedTestCount,
      executedTestCount: report.executedTestCount,
      deferredTestCount: report.deferredTestCount,
    })}`);
    if (!report.passed) process.exitCode = 1;
  } catch (error) {
    console.error(`[test-impact:advisory] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
