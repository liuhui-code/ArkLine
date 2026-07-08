#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const fileCount = numberArg(args.files, 5000);
const operations = numberArg(args.operations, 100);
const strict = Boolean(args.strict);
const targetMs = numberArg(args.target, 50);
const fixture = createFixture(fileCount);
const samples = [];

for (let index = 1; index <= operations; index += 1) {
  const query = index % 2 === 0 ? "width" : `width${index % 10}`;
  samples.push(measure(() => searchFixture(fixture, query, 50)));
}

const summary = summarize(samples);
const output = {
  scenario: "search-input",
  fileCount,
  operations,
  targetP95Ms: targetMs,
  ...summary,
  pass: summary.p95Ms <= targetMs,
};

console.log(JSON.stringify(output, null, 2));
if (strict && !output.pass) process.exit(1);

function createFixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    path: `/workspace/entry/src/main/ets/pages/Page${index}.ets`,
    content: `struct Page${index} {\n  build() {\n    Text("row ${index}").width(${index % 360})\n  }\n}`,
  }));
}

function searchFixture(files, query, limit) {
  const lower = query.toLowerCase();
  const matches = [];
  for (const file of files) {
    const line = file.content.toLowerCase();
    const column = line.indexOf(lower);
    if (column < 0) continue;
    matches.push({ path: file.path, column });
    if (matches.length >= limit) break;
  }
  return matches;
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
