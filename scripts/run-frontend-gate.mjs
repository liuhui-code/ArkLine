#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));
const strict = args.strict === true;
const timeoutMs = positiveNumber(args["timeout-ms"], 900_000);
const reportPath = typeof args.report === "string" ? args.report : "artifacts/frontend-gate.json";
const startedAt = new Date().toISOString();
const started = Date.now();
const child = spawn(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "--reporter=verbose",
    "--testTimeout=15000",
    "--hookTimeout=15000",
  ],
  {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ARKLINE_GATE_STRICT: strict ? "1" : "0" },
  },
);

child.stdout.on("data", (chunk) => process.stdout.write(chunk));
child.stderr.on("data", (chunk) => process.stderr.write(chunk));

let timedOut = false;
const heartbeat = setInterval(() => {
  const elapsed = Date.now() - started;
  console.log(`[frontend-gate] running for ${Math.round(elapsed / 1_000)}s; verbose test progress is above`);
}, 30_000);

const timeout = setTimeout(() => {
  timedOut = true;
  console.error(`[frontend-gate] timed out after ${timeoutMs}ms; terminating Vitest`);
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
}, timeoutMs);

const result = await new Promise((resolve) => {
  child.once("error", (error) => resolve({ exitCode: null, error: error.message }));
  child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
});

clearTimeout(timeout);
clearInterval(heartbeat);
const report = {
  schemaVersion: 1,
  gate: "frontend",
  startedAt,
  durationMs: Date.now() - started,
  timeoutMs,
  strict,
  timedOut,
  ...result,
  passed: !timedOut && result.exitCode === 0,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`ARKLINE_GATE ${JSON.stringify(report)}`);

if (!report.passed) {
  process.exitCode = 1;
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
