import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WINDOWS_TARGET = "x86_64-pc-windows-msvc";

export function resolvePnpmExecutable(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function resolveTarget(target) {
  return target ?? "windows-installer";
}

export function getOutputSummary({ target, platform = process.platform } = {}) {
  const resolvedTarget = resolveTarget(target);

  if (resolvedTarget === "windows-portable") {
    return [
      "",
      "Portable bundle output:",
      "  dist/ArkLine-windows-x64.zip",
      "",
      "The archive contains ArkLine.exe plus semantic and indexer sidecars.",
      platform === "win32" ? "" : "This build cross-compiles Windows binaries with cargo-xwin.",
    ].join("\n");
  }

  if (resolvedTarget === "mac") {
    return [
      "",
      "macOS binary output:",
      "  src-tauri/target/release/arkline",
    ].join("\n");
  }

  return [
    "",
    "Installer output:",
    `  src-tauri/target/${WINDOWS_TARGET}/release/bundle/nsis/`,
    "",
    "Note: the target machine still needs Microsoft WebView2 Runtime.",
  ].join("\n");
}

export function buildPackagingSteps({ target, hostPlatform = process.platform, skipFrontendBuild = false } = {}) {
  const resolvedTarget = resolveTarget(target);
  const steps = [];

  if (!skipFrontendBuild) {
    steps.push({ command: "pnpm", args: ["build"] });
  }

  if (resolvedTarget === "mac") {
    steps.push({ command: "node", args: ["scripts/build-semantic-sidecar.mjs"] });
    steps.push({ command: "node", args: ["scripts/build-indexer-sidecar.mjs"] });
    steps.push({
      command: "pnpm",
      args: ["tauri", "build", "--no-bundle"],
    });
    return steps;
  }

  if (resolvedTarget === "windows-portable") {
    steps.push({
      command: "node",
      args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", WINDOWS_TARGET],
    });
    steps.push({
      command: "node",
      args: hostPlatform === "win32"
        ? ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET]
        : ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET, "--runner", "cargo-xwin"],
    });
    steps.push({
      command: "pnpm",
      args: hostPlatform === "win32"
        ? ["tauri", "build", "--target", WINDOWS_TARGET, "--no-bundle"]
        : ["tauri", "build", "--runner", "cargo-xwin", "--target", WINDOWS_TARGET, "--no-bundle"],
    });
    steps.push({ command: "node", args: ["scripts/stage-windows-portable.mjs"] });
    return steps;
  }

  steps.push({
    command: "node",
    args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", WINDOWS_TARGET],
  });
  steps.push({
    command: "node",
    args: hostPlatform === "win32"
      ? ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET]
      : ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET, "--runner", "cargo-xwin"],
  });
  steps.push({
    command: "pnpm",
    args: hostPlatform === "win32"
      ? ["tauri", "build", "--target", WINDOWS_TARGET, "--bundles", "nsis"]
      : ["tauri", "build", "--runner", "cargo-xwin", "--target", WINDOWS_TARGET, "--bundles", "nsis"],
  });

  return steps;
}

function printOutputLocation(target) {
  console.log(getOutputSummary({ target }));
}

function runStep(step) {
  const command = step.command === "pnpm" ? resolvePnpmExecutable() : step.command;
  const result = spawnSync(command, step.args, {
    stdio: "inherit",
    shell: false,
  });

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return 1;
}

function parseCliArgs(argv) {
  const targetArgument = argv.find((argument) => argument.startsWith("--target="));
  const explicitTarget = targetArgument ? targetArgument.slice("--target=".length) : undefined;
  const legacyPortable = argv.includes("--portable");

  return {
    target: explicitTarget ?? (legacyPortable ? "windows-portable" : "windows-installer"),
    skipFrontendBuild: argv.includes("--skip-frontend-build"),
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseCliArgs(argv);
  const steps = buildPackagingSteps(options);

  for (const step of steps) {
    const exitCode = runStep(step);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
  }

  printOutputLocation(options.target);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === entryHref) {
  main();
}
