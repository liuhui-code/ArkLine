#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_MANIFEST = "docs/quality-gates.json";
const DEFAULT_REPORT_DIR = "artifacts";

export async function runQualityGate({ gateName, manifestPath = DEFAULT_MANIFEST, reportPath }) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const gate = manifest.gates?.[gateName];
  if (!gate) throw new Error(`Unknown quality gate: ${gateName}`);

  const startedAt = new Date().toISOString();
  const started = Date.now();
  const steps = [];
  let failedStep = null;

  for (const command of gate.steps) {
    const stepStarted = Date.now();
    console.log(`[quality-gate:${gateName}] START ${command}`);
    const result = await runCommand(command, gate.stepTimeoutMs ?? 900_000);
    const step = {
      command,
      durationMs: Date.now() - stepStarted,
      exitCode: result.exitCode,
      signal: result.signal ?? null,
      timedOut: result.timedOut,
      passed: result.exitCode === 0 && !result.timedOut,
    };
    steps.push(step);
    console.log(`[quality-gate:${gateName}] ${step.passed ? "PASS" : "FAIL"} ${command}`);
    if (!step.passed) {
      failedStep = command;
      break;
    }
  }

  const report = {
    schemaVersion: 1,
    gate: gateName,
    description: gate.description,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    passed: failedStep === null && steps.length === gate.steps.length,
    failedStep,
    steps,
  };
  const output = reportPath ?? path.join(DEFAULT_REPORT_DIR, `quality-gate-${gateName}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`ARKLINE_QUALITY_GATE ${JSON.stringify(report)}`);
  return report;
}

function runCommand(commandLine, timeoutMs) {
  const [command, ...args] = tokenize(commandLine);
  if (!command) return Promise.resolve({ exitCode: 1, timedOut: false });
  const executable = process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;

  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      console.error(`[quality-gate] timed out after ${timeoutMs}ms: ${commandLine}`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      console.error(`[quality-gate] could not start ${commandLine}: ${error.message}`);
      resolve({ exitCode: 1, timedOut });
    });
    child.once("close", (exitCode, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 1, signal, timedOut });
    });
  });
}

function tokenize(commandLine) {
  return commandLine.match(/(?:[^\s"]+|"[^"]*")+/gu)?.map((token) =>
    token.startsWith('"') && token.endsWith('"') ? token.slice(1, -1) : token,
  ) ?? [];
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const gateName = typeof args.gate === "string" ? args.gate : "fast";
  const report = await runQualityGate({
    gateName,
    manifestPath: path.resolve(typeof args.manifest === "string" ? args.manifest : DEFAULT_MANIFEST),
    reportPath: typeof args.report === "string" ? args.report : undefined,
  });
  if (!report.passed) process.exitCode = 1;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
