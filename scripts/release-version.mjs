import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export async function readReleaseVersion(rootPath = process.cwd()) {
  const [sourceVersionText, packageJson, cargoToml, tauriConfig] = await Promise.all([
    readFile(path.join(rootPath, "VERSION"), "utf8"),
    readFile(path.join(rootPath, "package.json"), "utf8"),
    readFile(path.join(rootPath, "src-tauri", "Cargo.toml"), "utf8"),
    readFile(path.join(rootPath, "src-tauri", "tauri.conf.json"), "utf8"),
  ]);
  const sourceVersion = sourceVersionText.trim();
  const packageVersion = JSON.parse(packageJson).version;
  const cargoPackage = cargoToml.split(/\n(?=\[)/u)
    .find((section) => section.startsWith("[package]")) ?? "";
  const cargoVersion = cargoPackage.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  const tauriVersion = JSON.parse(tauriConfig).version;
  const versions = [sourceVersion, packageVersion, cargoVersion, tauriVersion];

  if (versions.some((version) => typeof version !== "string") || new Set(versions).size !== 1) {
    throw new Error(`Release versions do not match: source=${sourceVersion}, package=${packageVersion}, cargo=${cargoVersion}, tauri=${tauriVersion}`);
  }
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u.test(sourceVersion)) {
    throw new Error(`Release version must be semantic: ${sourceVersion}`);
  }
  return sourceVersion;
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) {
  try {
    console.log(`ARKLINE_RELEASE_VERSION ${await readReleaseVersion()}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
