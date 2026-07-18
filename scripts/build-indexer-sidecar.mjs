import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function indexerSidecarOutput(targetTriple, root = projectRoot) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";
  return path.join(
    root,
    "src-tauri",
    "binaries",
    `arkline-indexer-${targetTriple}${extension}`,
  );
}

export function indexerBuildArtifact(targetTriple, root = projectRoot) {
  const extension = targetTriple.includes("windows") ? ".exe" : "";
  return path.join(
    root,
    "src-tauri",
    "target",
    targetTriple,
    "release",
    `arkline-indexer${extension}`,
  );
}

export function buildIndexerCommand(targetTriple, runner = "cargo") {
  const prefix = runner === "cargo-xwin" ? ["xwin"] : [];
  return {
    command: "cargo",
    args: [
      ...prefix,
      "build",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--release",
      "--target",
      targetTriple,
      "--bin",
      "arkline-indexer",
    ],
  };
}

export function hostTargetTriple() {
  const result = spawnSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(result.stderr.trim() || "Unable to determine the Rust host target triple");
  }
  return result.stdout.trim();
}

export function buildIndexerSidecar(argv = process.argv.slice(2)) {
  const targetTriple = readOption(argv, "--target-triple") ?? hostTargetTriple();
  const runner = readOption(argv, "--runner") ?? "cargo";
  const command = buildIndexerCommand(targetTriple, runner);
  const result = spawnSync(command.command, command.args, {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      TAURI_CONFIG: JSON.stringify({ bundle: { externalBin: [] } }),
    },
  });
  if (result.status !== 0) throw new Error(`Indexer sidecar build failed with ${result.status}`);

  const artifact = indexerBuildArtifact(targetTriple);
  const output = indexerSidecarOutput(targetTriple);
  if (!fs.statSync(artifact, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Indexer build artifact is missing: ${artifact}`);
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(artifact, output);
  if (targetTriple === hostTargetTriple()) smokeIndexerSidecar(output);
  return output;
}

export function smokeIndexerSidecar(outputPath) {
  const request = `${JSON.stringify({ id: "indexer-health", method: "health" })}\n`;
  const result = spawnSync(outputPath, [], {
    input: request,
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || "Indexer sidecar failed health check");
  }
  const response = JSON.parse(result.stdout.split(/\r?\n/, 1)[0] || "null");
  const capabilities = response?.payload?.capabilities ?? [];
  if (
    response?.id !== "indexer-health"
    || !response.ok
    || response.payload?.protocolVersion !== 4
    || !capabilities.includes("contentRefreshChunk")
    || !capabilities.includes("contentResourceBudget")
    || !capabilities.includes("stubRefreshChunk")
  ) {
    throw new Error(`Unexpected indexer sidecar response: ${result.stdout.trim()}`);
  }
}

function readOption(argv, name) {
  const inline = argv.find((value) => value.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) {
  try {
    console.log(`Indexer sidecar: ${buildIndexerSidecar()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
