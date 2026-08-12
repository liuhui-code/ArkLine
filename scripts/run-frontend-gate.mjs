#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { createTestNameBatches, collectNamedTests } from "./frontend-gate-plan.mjs";

const HEAVY_FILE = "tests/frontend/app-shell.test.tsx";
const HEAVY_SUITE = "App shell";
const HEAVY_BATCH_SIZE = 1;
const HEAVY_CONCURRENCY = 1;
const BASE_SHARDS = 6;
const BASE_CONCURRENCY = 2;
const TEST_TIMEOUT_MS = 15_000;
const HEAVY_STAGE_TIMEOUT_MS = 45_000;
const args = parseArgs(process.argv.slice(2));
const strict = args.strict === true;
const timeoutMs = positiveNumber(args["timeout-ms"], 1_800_000);
const reportPath = typeof args.report === "string" ? args.report : "artifacts/frontend-gate.json";
const startedAt = new Date().toISOString();
const started = Date.now();
const activeChildren = new Set();
const steps = [];
let timedOut = false;

const heartbeat = setInterval(() => {
  const elapsed = Math.round((Date.now() - started) / 1_000);
  const passed = steps.filter((step) => step.passed).length;
  console.log(`[frontend-gate] running ${elapsed}s; ${passed}/${steps.length} completed stages passed`);
}, 30_000);
const timeout = setTimeout(() => {
  timedOut = true;
  console.error(`[frontend-gate] timed out after ${timeoutMs}ms; terminating ${activeChildren.size} process(es)`);
  for (const child of activeChildren) child.kill("SIGTERM");
  setTimeout(() => {
    for (const child of activeChildren) child.kill("SIGKILL");
  }, 2_000).unref();
}, timeoutMs);

const basePassed = await runBaseShards();
if (basePassed && !timedOut) await runHeavyBatches();

clearTimeout(timeout);
clearInterval(heartbeat);
const failedStep = steps.find((step) => !step.passed)?.name ?? null;
const report = {
  schemaVersion: 2,
  gate: "frontend",
  startedAt,
  durationMs: Date.now() - started,
  timeoutMs,
  strict,
  timedOut,
  heavyBatchSize: HEAVY_BATCH_SIZE,
  heavyConcurrency: HEAVY_CONCURRENCY,
  baseShards: BASE_SHARDS,
  baseConcurrency: BASE_CONCURRENCY,
  failedStep,
  steps,
  passed: !timedOut && failedStep === null,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`ARKLINE_GATE ${JSON.stringify(report)}`);
if (!report.passed) process.exitCode = 1;

async function runHeavyBatches() {
  const source = await readFile(HEAVY_FILE, "utf8");
  const testNames = collectNamedTests(source, HEAVY_FILE);
  if (testNames.length === 0) {
    steps.push({ name: "app-shell-plan", passed: false, exitCode: 1, durationMs: 0 });
    return;
  }
  const batches = createTestNameBatches(HEAVY_SUITE, testNames, HEAVY_BATCH_SIZE);
  let nextBatch = 0;
  let failed = false;

  async function worker() {
    while (!failed && !timedOut) {
      const index = nextBatch++;
      if (index >= batches.length) return;
      const result = await runVitestStage(`app-shell-${index + 1}/${batches.length}`, [
        HEAVY_FILE,
        "--testNamePattern",
        batches[index],
      ], Math.min(HEAVY_BATCH_SIZE, testNames.length - index * HEAVY_BATCH_SIZE));
      if (!result.passed) failed = true;
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(HEAVY_CONCURRENCY, batches.length) },
    () => worker(),
  ));
}

async function runBaseShards() {
  let nextShard = 1;
  let failed = false;

  async function worker() {
    while (!failed && !timedOut) {
      const shard = nextShard++;
      if (shard > BASE_SHARDS) return;
      const result = await runVitestStage(`base-${shard}/${BASE_SHARDS}`, [
        "--exclude",
        HEAVY_FILE,
        `--shard=${shard}/${BASE_SHARDS}`,
      ]);
      if (!result.passed) failed = true;
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(BASE_CONCURRENCY, BASE_SHARDS) },
    () => worker(),
  ));
  return !failed && nextShard > BASE_SHARDS;
}

async function runVitestStage(name, extraArgs, expectedTestCount) {
  if (timedOut) return { name, passed: false, exitCode: 1, durationMs: 0 };
  const stepStarted = Date.now();
  const resultPath = path.join("artifacts", "frontend-gate-stages", `${stageSlug(name)}.json`);
  await mkdir(path.dirname(resultPath), { recursive: true });
  await writeFile(resultPath, "", "utf8");
  console.log(`[frontend-gate] START ${name}`);
  const result = await runProcess(process.execPath, [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--reporter=dot",
    "--reporter=json",
    `--outputFile.json=${resultPath}`,
    "--hideSkippedTests",
    "--bail=1",
    `--testTimeout=${TEST_TIMEOUT_MS}`,
    `--hookTimeout=${TEST_TIMEOUT_MS}`,
    ...extraArgs,
  ], name.startsWith("app-shell-") ? HEAVY_STAGE_TIMEOUT_MS : undefined);
  const testResult = await readTestResult(resultPath);
  const testCountMatches = expectedTestCount === undefined
    ? testResult.passedTests > 0
    : testResult.passedTests === expectedTestCount;
  if (!testCountMatches) {
    console.error(
      `[frontend-gate] ${name} executed ${testResult.passedTests} test(s); expected ${expectedTestCount ?? "at least one"}`,
    );
  }
  const step = {
    name,
    durationMs: Date.now() - stepStarted,
    exitCode: result.exitCode,
    signal: result.signal ?? null,
    timedOut: result.timedOut,
    testCount: testResult.passedTests,
    expectedTestCount: expectedTestCount ?? null,
    passed: !timedOut && result.exitCode === 0 && testCountMatches,
  };
  steps.push(step);
  console.log(`[frontend-gate] ${step.passed ? "PASS" : "FAIL"} ${name}`);
  return step;
}

async function readTestResult(resultPath) {
  try {
    const report = JSON.parse(await readFile(resultPath, "utf8"));
    return { passedTests: Number(report.numPassedTests) || 0 };
  } catch (error) {
    console.error(`[frontend-gate] could not read ${resultPath}: ${error instanceof Error ? error.message : String(error)}`);
    return { passedTests: 0 };
  }
}

function stageSlug(name) {
  return name.replace(/[^A-Za-z0-9_-]+/gu, "-");
}

function runProcess(command, commandArgs, stageTimeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, commandArgs, {
      cwd: process.cwd(),
      stdio: ["ignore", "inherit", "inherit"],
      env: { ...process.env, ARKLINE_GATE_STRICT: strict ? "1" : "0" },
      windowsHide: true,
    });
    activeChildren.add(child);
    let stageTimedOut = false;
    const stageTimeout = stageTimeoutMs ? setTimeout(() => {
      stageTimedOut = true;
      console.error(`[frontend-gate] ${commandArgs.at(-1)} timed out after ${stageTimeoutMs}ms`);
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, stageTimeoutMs) : null;
    child.once("error", (error) => {
      if (stageTimeout) clearTimeout(stageTimeout);
      activeChildren.delete(child);
      console.error(`[frontend-gate] could not start child: ${error.message}`);
      resolve({ exitCode: 1, timedOut: stageTimedOut });
    });
    child.once("close", (exitCode, signal) => {
      if (stageTimeout) clearTimeout(stageTimeout);
      activeChildren.delete(child);
      resolve({ exitCode: exitCode ?? 1, signal, timedOut: stageTimedOut });
    });
  });
}

function parseArgs(raw) {
  return Object.fromEntries(raw.map((item) => {
    const [key, value] = item.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
