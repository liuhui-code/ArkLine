import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readReleaseVersion } from "./release-version.mjs";

export function releaseCandidatePaths(rootPath, version) {
  return {
    installerPath: path.join(
      rootPath,
      "src-tauri",
      "target",
      "x86_64-pc-windows-msvc",
      "release",
      "bundle",
      "nsis",
      `ArkLine_${version}_x64-setup.exe`,
    ),
    portablePath: path.join(rootPath, "dist", "ArkLine-windows-x64.zip"),
    outputPath: path.join(rootPath, "artifacts", "release-candidate-manifest.json"),
  };
}

async function describeArtifact(kind, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Release candidate artifact is not a file: ${filePath}`);
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return {
    kind,
    name: path.basename(filePath),
    size: fileStat.size,
    sha256: hash.digest("hex"),
  };
}

export async function writeReleaseCandidateManifest({
  rootPath = process.cwd(),
  commitSha,
  installerPath,
  portablePath,
  outputPath,
}) {
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(commitSha)) {
    throw new Error(`Release candidate commit must be a full SHA: ${commitSha}`);
  }
  const version = await readReleaseVersion(rootPath);
  const defaults = releaseCandidatePaths(rootPath, version);
  const resolvedInstallerPath = installerPath ?? defaults.installerPath;
  const resolvedPortablePath = portablePath ?? defaults.portablePath;
  const resolvedOutputPath = outputPath ?? defaults.outputPath;
  const artifacts = await Promise.all([
    describeArtifact("installer", resolvedInstallerPath),
    describeArtifact("portable", resolvedPortablePath),
  ]);
  const manifest = {
    schemaVersion: 1,
    version,
    tag: `v${version}`,
    commitSha,
    artifacts,
  };
  await mkdir(path.dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) {
  try {
    const manifest = await writeReleaseCandidateManifest({
      commitSha: process.env.GITHUB_SHA,
    });
    console.log(`ARKLINE_RELEASE_CANDIDATE ${manifest.tag} ${manifest.commitSha}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
