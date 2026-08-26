import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyReleaseCandidate } from "../../scripts/verify-release-candidate.mjs";

const candidateSha = "0123456789abcdef0123456789abcdef01234567";

async function createCandidate(root: string) {
  const version = "0.1.32";
  const installerPath = path.join(
    root,
    "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis",
    `ArkLine_${version}_x64-setup.exe`,
  );
  const portablePath = path.join(root, "dist", "ArkLine-windows-x64.zip");
  const manifestPath = path.join(root, "artifacts", "release-candidate-manifest.json");
  await Promise.all([
    mkdir(path.dirname(installerPath), { recursive: true }),
    mkdir(path.dirname(portablePath), { recursive: true }),
    mkdir(path.dirname(manifestPath), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(installerPath, "installer", "utf8"),
    writeFile(portablePath, "portable", "utf8"),
  ]);
  await writeFile(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    version,
    tag: `v${version}`,
    commitSha: candidateSha,
    artifacts: [
      {
        kind: "installer",
        name: path.basename(installerPath),
        size: 9,
        sha256: createHash("sha256").update("installer").digest("hex"),
      },
      {
        kind: "portable",
        name: path.basename(portablePath),
        size: 8,
        sha256: createHash("sha256").update("portable").digest("hex"),
      },
    ],
  }, null, 2)}\n`, "utf8");
  return { installerPath, portablePath, manifestPath };
}

describe("release candidate verification", () => {
  it("accepts exactly the installer and portable bound to the requested tag and CI commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-verify-candidate-"));
    try {
      const paths = await createCandidate(root);
      await expect(verifyReleaseCandidate({
        candidateRoot: root,
        releaseTag: "v0.1.32",
        commitSha: candidateSha,
      })).resolves.toEqual({
        tag: "v0.1.32",
        commitSha: candidateSha,
        installerPath: paths.installerPath,
        portablePath: paths.portablePath,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a candidate whose requested tag or CI commit does not match its manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-verify-identity-"));
    try {
      await createCandidate(root);
      await expect(verifyReleaseCandidate({
        candidateRoot: root,
        releaseTag: "v0.1.33",
        commitSha: candidateSha,
      })).rejects.toThrow("Candidate tag v0.1.32 does not match requested tag v0.1.33");
      await expect(verifyReleaseCandidate({
        candidateRoot: root,
        releaseTag: "v0.1.32",
        commitSha: "abcdef0123456789abcdef0123456789abcdef01",
      })).rejects.toThrow("Candidate commit does not match CI run commit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a candidate artifact changed after smoke verification", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-verify-tamper-"));
    try {
      const { portablePath } = await createCandidate(root);
      await writeFile(portablePath, "changed", "utf8");
      await expect(verifyReleaseCandidate({
        candidateRoot: root,
        releaseTag: "v0.1.32",
        commitSha: candidateSha,
      })).rejects.toThrow("Candidate portable size does not match manifest");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exports verified asset paths for the promotion workflow", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "arkline-verify-cli-"));
    try {
      await createCandidate(root);
      const outputPath = path.join(root, "github-output.txt");
      const run = spawnSync(process.execPath, [
        path.join(process.cwd(), "scripts", "verify-release-candidate.mjs"),
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          ARKLINE_CANDIDATE_ROOT: root,
          ARKLINE_RELEASE_TAG: "v0.1.32",
          ARKLINE_CANDIDATE_SHA: candidateSha,
          GITHUB_OUTPUT: outputPath,
        },
      });

      expect(run.status).toBe(0);
      expect(run.stdout).toContain(`ARKLINE_CANDIDATE_VERIFIED v0.1.32 ${candidateSha}`);
      expect(await readFile(outputPath, "utf8")).toContain("installer_path=");
      expect(await readFile(outputPath, "utf8")).toContain("portable_path=");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
