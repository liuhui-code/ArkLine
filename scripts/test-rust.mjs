import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function testTauriConfig(existing = process.env.TAURI_CONFIG) {
  const config = existing ? JSON.parse(existing) : {};
  return JSON.stringify({
    ...config,
    bundle: {
      ...(config.bundle ?? {}),
      externalBin: [],
    },
  });
}

export function rustTestEnvironment(
  platform = process.platform,
  architecture = process.arch,
  environment = process.env,
) {
  const result = { ...environment, TAURI_CONFIG: testTauriConfig(environment.TAURI_CONFIG) };
  if (platform !== "darwin") return result;
  const target = architecture === "arm64"
    ? "AARCH64_APPLE_DARWIN"
    : "X86_64_APPLE_DARWIN";
  const runnerPath = path.resolve("scripts/run-rust-test-binary.mjs");
  result[`CARGO_TARGET_${target}_RUNNER`] = `node ${runnerPath}`;
  return result;
}

export function main() {
  const result = spawnSync(
    "cargo",
    [
      "test",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--lib",
      "--test", "indexer_sidecar",
      "--test", "runtime_logging",
      "--",
      "--test-threads=1",
    ],
    {
      stdio: "inherit",
      env: rustTestEnvironment(),
    },
  );
  if (result.error) {
    console.error(result.error.message);
    return 1;
  }
  return result.status ?? 1;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) process.exit(main());
