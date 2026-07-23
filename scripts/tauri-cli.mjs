import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WINDOWS_TARGET = "x86_64-pc-windows-msvc";
const TARGET_COMMANDS = new Set(["dev", "build"]);

export function resolveTauriExecutable(platform = process.platform) {
  return platform === "win32" ? "tauri.cmd" : "tauri";
}

export function tauriSpawnOptions(platform = process.platform) {
  return {
    stdio: "inherit",
    shell: platform === "win32",
  };
}

function hasExplicitTarget(args) {
  return args.some((arg) => arg === "--target" || arg === "-t" || arg.startsWith("--target="));
}

export function buildTauriArgs(args, platform = process.platform) {
  const [command, ...rest] = args;

  if (platform !== "win32" || !TARGET_COMMANDS.has(command) || hasExplicitTarget(args)) {
    return args;
  }

  return [command, "--target", WINDOWS_TARGET, ...rest];
}

export function main(argv = process.argv.slice(2)) {
  const command = resolveTauriExecutable();
  const args = buildTauriArgs(argv);
  const result = spawnSync(command, args, tauriSpawnOptions());

  if (typeof result.status === "number") {
    process.exit(result.status);
  }

  if (result.error) {
    console.error(result.error.message);
  }
  process.exit(1);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryHref) {
  main();
}
