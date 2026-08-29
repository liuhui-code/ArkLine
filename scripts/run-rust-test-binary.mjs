import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdtempSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function runStagedRustTestBinary(
  executable,
  args,
  environment = process.env,
) {
  const stagingDirectory = mkdtempSync(path.join(tmpdir(), "arkline-rust-test-"));
  const stagedExecutable = path.join(stagingDirectory, path.basename(executable));
  try {
    copyFileSync(executable, stagedExecutable);
    chmodSync(stagedExecutable, statSync(executable).mode);
    const result = spawnSync(stagedExecutable, args, {
      env: environment,
      stdio: "inherit",
    });
    if (result.error) {
      console.error(result.error.message);
      return 1;
    }
    return result.status ?? 1;
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

export function main(argv = process.argv.slice(2)) {
  const [executable, ...args] = argv;
  if (!executable) {
    console.error("Rust test runner requires an executable path");
    return 1;
  }
  return runStagedRustTestBinary(executable, args);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) process.exit(main());
