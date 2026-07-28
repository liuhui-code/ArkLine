#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const strict = process.argv.includes("--strict");
const tests = [
  "tests/frontend/use-editor-navigation.test.tsx",
  "tests/frontend/navigation-document-open-transaction.test.tsx",
  "tests/frontend/editor-crash-boundary.test.tsx",
  "tests/frontend/app-crash-boundary.test.tsx",
];

const result = spawnSync(
  process.execPath,
  ["node_modules/vitest/vitest.mjs", "run", ...tests, "--reporter=verbose"],
  {
    cwd: process.cwd(),
    stdio: "inherit",
    env: {
      ...process.env,
      ARKLINE_SOAK_STRICT: strict ? "1" : process.env.ARKLINE_SOAK_STRICT ?? "0",
    },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`ARKLINE_PERF ${JSON.stringify({
  scenario: "core-interaction-correctness",
  strict,
  tests: tests.length,
  passed: true,
})}`);
