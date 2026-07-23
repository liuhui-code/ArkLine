#!/usr/bin/env node
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const PROFILE_FILE_COUNTS = Object.freeze({
  small: 1_000,
  medium: 20_000,
  huge: 100_000,
});

const FIXTURE_VERSION = 1;
const MARKER_NAME = ".arkline-performance-fixture.json";
const WRITE_BATCH_SIZE = 256;

export function parseFixtureArguments(argv = process.argv.slice(2)) {
  const profile = argumentValue(argv, "--profile") ?? "medium";
  if (!(profile in PROFILE_FILE_COUNTS)) {
    throw new Error(`Unknown fixture profile: ${profile}`);
  }
  const outputPath = argumentValue(argv, "--output")
    ?? path.resolve("artifacts", `arkline-${profile}-fixture`);
  return {
    profile,
    fileCount: PROFILE_FILE_COUNTS[profile],
    outputPath,
    force: argv.includes("--force"),
  };
}

export function buildFixtureRelativePath(index) {
  const moduleIndex = String(index % 128).padStart(3, "0");
  const pageIndex = String(index).padStart(6, "0");
  return `module-${moduleIndex}/src/main/ets/Page${pageIndex}.ets`;
}

export function renderFixtureSource(index) {
  const pageIndex = String(index).padStart(6, "0");
  return [
    `export class Page${pageIndex} {`,
    `  public arklineSearchNeedle${index}(): string {`,
    `    return "fixture-${index}";`,
    "  }",
    "",
    `  private compute${pageIndex}(value: number): number {`,
    `    return value + ${index};`,
    "  }",
    "}",
    "",
  ].join("\n");
}

export async function generatePerformanceFixture(options) {
  const outputPath = path.resolve(options.outputPath);
  const expectedMarker = markerFor(options.profile, options.fileCount);
  if (await fixtureMatches(outputPath, expectedMarker)) {
    return { ...expectedMarker, outputPath, reused: true };
  }
  await prepareOutput(outputPath, options.force);
  await writeFixtureFiles(outputPath, options.fileCount);
  await writeFile(
    path.join(outputPath, MARKER_NAME),
    `${JSON.stringify(expectedMarker, null, 2)}\n`,
  );
  return { ...expectedMarker, outputPath, reused: false };
}

async function fixtureMatches(outputPath, expectedMarker) {
  try {
    const payload = JSON.parse(
      await readFile(path.join(outputPath, MARKER_NAME), "utf8"),
    );
    return payload.version === expectedMarker.version
      && payload.profile === expectedMarker.profile
      && payload.fileCount === expectedMarker.fileCount;
  } catch {
    return false;
  }
}

async function prepareOutput(outputPath, force) {
  const entries = await readdir(outputPath).catch(() => []);
  if (entries.length > 0) {
    const ownsDirectory = entries.includes(MARKER_NAME);
    if (!ownsDirectory && !force) {
      throw new Error(
        `Refusing to replace non-fixture directory: ${outputPath}. Use --force explicitly.`,
      );
    }
    await rm(outputPath, { recursive: true, force: true });
  }
  await mkdir(outputPath, { recursive: true });
}

async function writeFixtureFiles(outputPath, fileCount) {
  for (let start = 0; start < fileCount; start += WRITE_BATCH_SIZE) {
    const end = Math.min(fileCount, start + WRITE_BATCH_SIZE);
    await Promise.all(
      Array.from({ length: end - start }, async (_, offset) => {
        const index = start + offset;
        const destination = path.join(outputPath, buildFixtureRelativePath(index));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, renderFixtureSource(index));
      }),
    );
  }
}

function markerFor(profile, fileCount) {
  return {
    version: FIXTURE_VERSION,
    profile,
    fileCount,
    searchNeedle: "arklineSearchNeedle",
  };
}

function argumentValue(argv, name) {
  const inline = argv.find((argument) => argument.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

async function main() {
  const options = parseFixtureArguments();
  const result = await generatePerformanceFixture(options);
  console.log(`ARKLINE_FIXTURE ${JSON.stringify(result)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
