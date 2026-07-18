#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const strict = args.includes("--strict");
const fileArg = args.find((item) => item.startsWith("--files=")) ?? "--files=5000";
const operationsArg = args.find((item) => item.startsWith("--operations=")) ?? "--operations=100";
const switchesArg = args.find((item) => item.startsWith("--switches=")) ?? "--switches=50";
const common = strict ? ["--strict"] : [];

const commands = [
  ["node", ["scripts/perf-search-input.mjs", fileArg, operationsArg, ...common]],
  ["node", ["scripts/perf-file-switch.mjs", fileArg, switchesArg, ...common]],
];

for (const [command, commandArgs] of commands) {
  const result = spawnSync(command, commandArgs, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
