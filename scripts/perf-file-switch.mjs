#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const result = spawnSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/frontend/runtime-interaction-soak.test.tsx",
    "--reporter=verbose",
    "-t",
    "keeps file switch and jump soak latest-wins and bounded",
  ],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      ARKLINE_SOAK_FILE_COUNT: stringArg(args.files, "5000"),
      ARKLINE_SOAK_SWITCHES: stringArg(args.switches, "50"),
      ARKLINE_SOAK_FILE_TARGET_MS: stringArg(args.target, "300"),
      ARKLINE_SOAK_STRICT: args.strict ? "1" : "0",
    },
  },
);

process.exit(result.status ?? 1);

function parseArgs(raw) {
  return Object.fromEntries(raw.map((item) => {
    const [key, value] = item.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

function stringArg(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}
