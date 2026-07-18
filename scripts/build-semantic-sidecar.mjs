import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TARGETS = new Map([
  ["x86_64-pc-windows-msvc", { pkg: "node24-win-x64", extension: ".exe" }],
  ["aarch64-pc-windows-msvc", { pkg: "node24-win-arm64", extension: ".exe" }],
  ["x86_64-apple-darwin", { pkg: "node24-macos-x64", extension: "" }],
  ["aarch64-apple-darwin", { pkg: "node24-macos-arm64", extension: "" }],
  ["x86_64-unknown-linux-gnu", { pkg: "node24-linux-x64", extension: "" }],
  ["aarch64-unknown-linux-gnu", { pkg: "node24-linux-arm64", extension: "" }],
]);

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function resolvePkgTarget(targetTriple) {
  const target = TARGETS.get(targetTriple);
  if (!target) throw new Error(`Unsupported semantic sidecar target: ${targetTriple}`);
  return target.pkg;
}

export function semanticSidecarOutput(targetTriple, root = projectRoot) {
  const target = TARGETS.get(targetTriple);
  if (!target) throw new Error(`Unsupported semantic sidecar target: ${targetTriple}`);
  return path.join(
    root,
    "src-tauri",
    "binaries",
    `arkline-semantic-${targetTriple}${target.extension}`,
  );
}

export function hostTargetTriple() {
  const result = spawnSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) {
    throw new Error(result.stderr.trim() || "Unable to determine the Rust host target triple");
  }
  return result.stdout.trim();
}

export function buildSemanticSidecar(argv = process.argv.slice(2)) {
  const targetTriple = readOption(argv, "--target-triple") ?? hostTargetTriple();
  const pkgTarget = resolvePkgTarget(targetTriple);
  const outputPath = semanticSidecarOutput(targetTriple);
  const bundlePath = path.join(projectRoot, "semantic-worker", "bundle", "semantic-worker.cjs");
  const pkgEntry = path.join(projectRoot, "node_modules", "@yao-pkg", "pkg", "lib-es5", "bin.js");
  if (!fs.existsSync(bundlePath)) throw new Error(`Semantic bundle is missing: ${bundlePath}`);
  if (!fs.existsSync(pkgEntry)) throw new Error("@yao-pkg/pkg is not installed");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const result = spawnSync(process.execPath, [
    pkgEntry,
    bundlePath,
    "--targets", pkgTarget,
    "--output", outputPath,
    "--compress", "GZip",
    "--no-bytecode",
    "--public",
    "--public-packages", "*",
    "--no-native-build",
  ], { cwd: projectRoot, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`Semantic sidecar build failed with ${result.status}`);
  if (targetTriple === hostTargetTriple()) smokeSemanticSidecar(outputPath);
  return outputPath;
}

export function smokeSemanticSidecar(outputPath) {
  const request = `${JSON.stringify({ id: "standalone-health", method: "health" })}\n`;
  const result = spawnSync(outputPath, [], {
    input: request,
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) {
    throw new Error(result.error?.message || result.stderr.trim() || "Semantic sidecar failed health check");
  }
  const response = JSON.parse(result.stdout.split(/\r?\n/, 1)[0] || "null");
  if (response?.id !== "standalone-health" || !response.ok || response.payload?.protocolVersion !== 3) {
    throw new Error(`Unexpected semantic sidecar response: ${result.stdout.trim()}`);
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
    const outputPath = buildSemanticSidecar();
    console.log(`Semantic sidecar: ${outputPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
