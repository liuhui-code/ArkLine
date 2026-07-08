#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const fileCount = numberArg(args.files, 5000);
const switches = numberArg(args.switches, 50);
const strict = Boolean(args.strict);
const targetMs = numberArg(args.target, 300);
const fixture = createFixture(fileCount);
const samples = [];

for (let index = 0; index < switches; index += 1) {
  const file = fixture[(index * 97) % fixture.length];
  samples.push(measure(() => firstPaintProjection(file)));
}

const summary = summarize(samples);
const output = {
  scenario: "file-switch",
  fileCount,
  switches,
  targetP95Ms: targetMs,
  ...summary,
  pass: summary.p95Ms <= targetMs,
};

console.log(JSON.stringify(output, null, 2));
if (strict && !output.pass) process.exit(1);

function createFixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    path: `/workspace/entry/src/main/ets/pages/Page${index}.ets`,
    content: Array.from({ length: 120 }, (_, line) => `  method${line}() { return ${index + line}; }`).join("\n"),
  }));
}

function firstPaintProjection(file) {
  const lines = file.content.split("\n");
  return {
    path: file.path,
    title: file.path.slice(file.path.lastIndexOf("/") + 1),
    firstVisibleLines: lines.slice(0, 80),
    lineCount: lines.length,
  };
}

function measure(fn) {
  const startedAt = performance.now();
  fn();
  return performance.now() - startedAt;
}

function summarize(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    maxMs: sorted.at(-1) ?? 0,
  };
}

function percentile(sorted, value) {
  if (sorted.length === 0) return 0;
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)].toFixed(3));
}

function parseArgs(raw) {
  return Object.fromEntries(raw.map((item) => {
    const [key, value] = item.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
