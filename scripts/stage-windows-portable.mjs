import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const WINDOWS_TARGET = "x86_64-pc-windows-msvc";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function portableBundlePaths(root = projectRoot) {
  const targetRoot = path.join(root, "src-tauri", "target", WINDOWS_TARGET, "release");
  const stageDir = path.join(root, "dist", "ArkLine-windows-x64");
  return {
    appSource: path.join(targetRoot, "arkline.exe"),
    sidecarSource: path.join(
      root,
      "src-tauri",
      "binaries",
      `arkline-semantic-${WINDOWS_TARGET}.exe`,
    ),
    indexerSource: path.join(
      root,
      "src-tauri",
      "binaries",
      `arkline-indexer-${WINDOWS_TARGET}.exe`,
    ),
    stageDir,
    appTarget: path.join(stageDir, "ArkLine.exe"),
    sidecarTarget: path.join(stageDir, "arkline-semantic.exe"),
    indexerTarget: path.join(stageDir, "arkline-indexer.exe"),
    archivePath: path.join(root, "dist", "ArkLine-windows-x64.zip"),
  };
}

export function stageWindowsPortable({ root = projectRoot, platform = process.platform } = {}) {
  const paths = portableBundlePaths(root);
  requireFile(paths.appSource);
  requireFile(paths.sidecarSource);
  requireFile(paths.indexerSource);
  fs.rmSync(paths.stageDir, { recursive: true, force: true });
  fs.rmSync(paths.archivePath, { force: true });
  fs.mkdirSync(paths.stageDir, { recursive: true });
  fs.copyFileSync(paths.appSource, paths.appTarget);
  fs.copyFileSync(paths.sidecarSource, paths.sidecarTarget);
  fs.copyFileSync(paths.indexerSource, paths.indexerTarget);
  createArchive(paths, platform);
  return paths.archivePath;
}

function requireFile(filePath) {
  if (!fs.statSync(filePath, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Portable bundle input is missing: ${filePath}`);
  }
}

function createArchive(paths, platform) {
  let result;
  if (platform === "win32") {
    result = spawnSync("powershell", [
      "-NoProfile",
      "-Command",
      "Compress-Archive",
      "-Path",
      `${paths.stageDir}\\*`,
      "-DestinationPath",
      paths.archivePath,
      "-Force",
    ], { stdio: "inherit" });
  } else if (platform === "darwin") {
    result = spawnSync("ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      paths.stageDir,
      paths.archivePath,
    ], { stdio: "inherit" });
  } else {
    result = spawnSync("zip", ["-r", paths.archivePath, "."], {
      cwd: paths.stageDir,
      stdio: "inherit",
    });
  }
  if (result.status !== 0) {
    throw new Error(result.error?.message || `Portable archive command failed with ${result.status}`);
  }
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) {
  try {
    console.log(`Portable bundle: ${stageWindowsPortable()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
