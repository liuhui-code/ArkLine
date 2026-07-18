import { spawnSync } from "node:child_process";
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

export function main() {
  const result = spawnSync(
    "cargo",
    ["test", "--manifest-path", "src-tauri/Cargo.toml"],
    {
      stdio: "inherit",
      env: { ...process.env, TAURI_CONFIG: testTauriConfig() },
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
