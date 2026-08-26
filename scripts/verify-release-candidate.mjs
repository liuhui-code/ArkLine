import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function sha256(filePath) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", resolve);
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

function requireArtifact(manifest, kind, expectedName) {
  const matches = manifest.artifacts.filter((artifact) => artifact?.kind === kind);
  if (matches.length !== 1) {
    throw new Error(`Candidate manifest must contain exactly one ${kind} artifact`);
  }
  const artifact = matches[0];
  if (artifact.name !== expectedName) {
    throw new Error(`Candidate ${kind} name does not match version: ${artifact.name}`);
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size < 0) {
    throw new Error(`Candidate ${kind} size is invalid`);
  }
  if (typeof artifact.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(artifact.sha256)) {
    throw new Error(`Candidate ${kind} SHA-256 is invalid`);
  }
  return artifact;
}

async function verifyArtifact(kind, artifact, filePath) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error(`Candidate ${kind} is not a file: ${filePath}`);
  if (fileStat.size !== artifact.size) {
    throw new Error(`Candidate ${kind} size does not match manifest`);
  }
  if (await sha256(filePath) !== artifact.sha256) {
    throw new Error(`Candidate ${kind} SHA-256 does not match manifest`);
  }
}

export async function verifyReleaseCandidate({ candidateRoot, releaseTag, commitSha }) {
  if (typeof releaseTag !== "string" || !/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(releaseTag)) {
    throw new Error(`Requested release tag is invalid: ${releaseTag}`);
  }
  if (typeof commitSha !== "string" || !/^[0-9a-f]{40}$/u.test(commitSha)) {
    throw new Error(`CI run commit must be a full SHA: ${commitSha}`);
  }
  const manifestPath = path.join(candidateRoot, "artifacts", "release-candidate-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) {
    throw new Error("Candidate manifest schema is invalid");
  }
  if (manifest.tag !== releaseTag) {
    throw new Error(`Candidate tag ${manifest.tag} does not match requested tag ${releaseTag}`);
  }
  if (manifest.commitSha !== commitSha) {
    throw new Error("Candidate commit does not match CI run commit");
  }
  if (manifest.tag !== `v${manifest.version}`) {
    throw new Error("Candidate version and tag do not match");
  }
  if (manifest.artifacts.length !== 2) {
    throw new Error("Candidate manifest must contain exactly two artifacts");
  }

  const installerName = `ArkLine_${manifest.version}_x64-setup.exe`;
  const portableName = "ArkLine-windows-x64.zip";
  const installer = requireArtifact(manifest, "installer", installerName);
  const portable = requireArtifact(manifest, "portable", portableName);
  const installerPath = path.join(
    candidateRoot,
    "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis",
    installerName,
  );
  const portablePath = path.join(candidateRoot, "dist", portableName);
  await Promise.all([
    verifyArtifact("installer", installer, installerPath),
    verifyArtifact("portable", portable, portablePath),
  ]);
  return { tag: manifest.tag, commitSha: manifest.commitSha, installerPath, portablePath };
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) {
  try {
    const verified = await verifyReleaseCandidate({
      candidateRoot: process.env.ARKLINE_CANDIDATE_ROOT,
      releaseTag: process.env.ARKLINE_RELEASE_TAG,
      commitSha: process.env.ARKLINE_CANDIDATE_SHA,
    });
    if (process.env.GITHUB_OUTPUT) {
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `installer_path=${verified.installerPath}\nportable_path=${verified.portablePath}\n`,
        "utf8",
      );
    }
    console.log(`ARKLINE_CANDIDATE_VERIFIED ${verified.tag} ${verified.commitSha}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
