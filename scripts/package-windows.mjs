import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const WINDOWS_TARGET = "x86_64-pc-windows-msvc";
const DEFAULT_STEP_TIMEOUT_MS = 20 * 60_000;

function sleepSync(delayMs) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}

export function resolvePnpmExecutable(platform = process.platform) {
  return platform === "win32" ? "pnpm.cmd" : "pnpm";
}

export function packagingSpawnOptions(platform = process.platform) {
  return {
    stdio: "inherit",
    shell: platform === "win32",
  };
}

export function packagingStepTimeoutMs(value = process.env.ARKLINE_PACKAGING_STEP_TIMEOUT_MS) {
  if (value === undefined || value === "") return DEFAULT_STEP_TIMEOUT_MS;
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("ARKLINE_PACKAGING_STEP_TIMEOUT_MS must be a positive number");
  }
  return timeout;
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

  if (resolvedTarget === "windows-candidate" && hostPlatform !== "win32") {
    throw new Error("windows-candidate packaging requires a Windows host");
  }

  if (!skipFrontendBuild) {
    steps.push({ name: "frontend-build", command: "pnpm", args: ["build"] });
  }

  if (resolvedTarget === "mac") {
    steps.push({ name: "semantic-sidecar", command: "node", args: ["scripts/build-semantic-sidecar.mjs"] });
    steps.push({ name: "indexer-sidecar", command: "node", args: ["scripts/build-indexer-sidecar.mjs"] });
    steps.push({
      name: "tauri-binary",
      command: "pnpm",
      args: ["tauri", "build", "--no-bundle"],
    });
    return steps;
  }

  if (resolvedTarget === "windows-portable") {
    steps.push({
      name: "semantic-sidecar",
      command: "node",
      args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", WINDOWS_TARGET],
    });
    steps.push({
      name: "indexer-sidecar",
      command: "node",
      args: hostPlatform === "win32"
        ? ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET]
        : ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET, "--runner", "cargo-xwin"],
    });
    steps.push({
      name: "tauri-binary",
      command: "pnpm",
      args: hostPlatform === "win32"
        ? ["tauri", "build", "--target", WINDOWS_TARGET, "--no-bundle"]
        : ["tauri", "build", "--runner", "cargo-xwin", "--target", WINDOWS_TARGET, "--no-bundle"],
    });
    steps.push({ name: "stage-portable", command: "node", args: ["scripts/stage-windows-portable.mjs"] });
    return steps;
  }

  if (resolvedTarget === "windows-candidate") {
    steps.push({
      name: "semantic-sidecar",
      command: "node",
      args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", WINDOWS_TARGET],
    });
    steps.push({
      name: "indexer-sidecar",
      command: "node",
      args: ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET],
    });
    steps.push({
      name: "tauri-binary",
      command: "pnpm",
      args: ["tauri", "build", "--target", WINDOWS_TARGET, "--no-bundle"],
    });
    steps.push({ name: "stage-portable", command: "node", args: ["scripts/stage-windows-portable.mjs"] });
    steps.push({
      name: "tauri-installer",
      command: "pnpm",
      args: ["tauri", "bundle", "--target", WINDOWS_TARGET, "--bundles", "nsis"],
      maxAttempts: 3,
      retryDelayMs: 10_000,
    });
    return steps;
  }

  steps.push({
    name: "semantic-sidecar",
    command: "node",
    args: ["scripts/build-semantic-sidecar.mjs", "--target-triple", WINDOWS_TARGET],
  });
  steps.push({
    name: "indexer-sidecar",
    command: "node",
    args: hostPlatform === "win32"
      ? ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET]
      : ["scripts/build-indexer-sidecar.mjs", "--target-triple", WINDOWS_TARGET, "--runner", "cargo-xwin"],
  });
  steps.push({
    name: "tauri-binary",
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

export function formatPackagingStepStart(step, timeoutMs) {
  return `[package] start ${step.name ?? step.command} (timeout ${Math.round(timeoutMs / 60_000)}m)`;
}

export function formatPackagingStepEnd(step, durationMs) {
  return `[package] done ${step.name ?? step.command} (${(durationMs / 1_000).toFixed(1)}s)`;
}

export function runStep(step, timeoutMs = packagingStepTimeoutMs(), now = Date.now, spawn = spawnSync) {
  const command = step.command === "pnpm" ? resolvePnpmExecutable() : step.command;
  const startedAt = now();
  console.log(formatPackagingStepStart(step, timeoutMs));
  const result = spawn(command, step.args, {
    ...packagingSpawnOptions(),
    timeout: timeoutMs,
  });
  console.log(formatPackagingStepEnd(step, Math.max(0, now() - startedAt)));

  if (typeof result.status === "number") {
    return result.status;
  }

  if (result.error) {
    console.error(`${step.name ?? command} failed: ${result.error.message}`);
    return 1;
  }

  return 1;
}

export function runStepWithRetry(
  step,
  timeoutMs = packagingStepTimeoutMs(),
  now = Date.now,
  spawn = spawnSync,
  sleep = sleepSync,
) {
  const maxAttempts = Math.max(1, step.maxAttempts ?? 1);
  const retryDelayMs = Math.max(0, step.retryDelayMs ?? 0);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const exitCode = runStep(step, timeoutMs, now, spawn);
    if (exitCode === 0 || attempt === maxAttempts) return exitCode;

    console.warn(
      `[package] ${step.name ?? step.command} attempt ${attempt}/${maxAttempts} failed; `
      + `retrying in ${(retryDelayMs / 1_000).toFixed(0)}s`,
    );
    sleep(retryDelayMs);
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

  const timeoutMs = packagingStepTimeoutMs();
  for (const step of steps) {
    const exitCode = runStepWithRetry(step, timeoutMs);
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
