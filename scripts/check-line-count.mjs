#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_LIMIT = 500;
const DEFAULT_ROOTS = ["src", "semantic-worker/src", "scripts", "src-tauri/src"];
const TARGET_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx", ".rs"]);
const IGNORED_DIRS = new Set([".git", "__tests__", "dist", "node_modules", "target"]);

export function collectLineCountViolations(files, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  return files
    .filter((file) => isTargetPath(file.path))
    .map((file) => ({ path: file.path, lineCount: countLines(file.text), limit }))
    .filter((file) => file.lineCount > limit)
    .sort((left, right) => left.path.localeCompare(right.path));
}

export async function collectProjectFiles(cwd, roots = DEFAULT_ROOTS) {
  const files = [];
  for (const root of roots) {
    await collectFilesFromPath(path.resolve(cwd, root), cwd, files);
  }
  return files;
}

async function collectFilesFromPath(absolutePath, cwd, files) {
  let pathStats;
  try {
    pathStats = await stat(absolutePath);
  } catch {
    return;
  }

  if (pathStats.isFile()) {
    await collectFile(absolutePath, cwd, files);
    return;
  }
  if (!pathStats.isDirectory()) return;

  let entries;
  try {
    entries = await readdir(absolutePath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const nextPath = path.join(absolutePath, entry.name);
    if (entry.isDirectory()) {
      await collectFilesFromPath(nextPath, cwd, files);
      continue;
    }
    if (!entry.isFile()) continue;
    await collectFile(nextPath, cwd, files);
  }
}

async function collectFile(absolutePath, cwd, files) {
  const relativePath = toPosix(path.relative(cwd, absolutePath));
  if (!isTargetPath(relativePath)) return;
  files.push({ path: relativePath, text: await readFile(absolutePath, "utf8") });
}

function countLines(text) {
  if (text.length === 0) return 0;
  return text.endsWith("\n") ? text.split("\n").length - 1 : text.split("\n").length;
}

function isTargetPath(filePath) {
  const normalized = toPosix(filePath);
  if (
    normalized.startsWith("node_modules/")
    || normalized.startsWith("dist/")
    || normalized.startsWith("target/")
    || normalized.includes("/node_modules/")
    || normalized.includes("/dist/")
    || normalized.includes("/target/")
    || normalized.includes("/__tests__/")
  ) {
    return false;
  }
  if (normalized.endsWith(".d.ts")) return false;
  return TARGET_EXTENSIONS.has(path.extname(normalized));
}

function toPosix(filePath) {
  return filePath.split(path.sep).join("/");
}

async function main() {
  const cwd = process.cwd();
  const limit = Number.parseInt(process.argv.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ?? "", 10)
    || DEFAULT_LIMIT;
  const roots = parseRoots(process.argv);
  const files = await collectProjectFiles(cwd, roots);
  const violations = collectLineCountViolations(files, { limit });

  if (violations.length === 0) {
    console.log(`Line count check passed: ${files.length} files <= ${limit} lines`);
    return;
  }

  console.error(`Line count check failed: ${violations.length} file(s) exceed ${limit} lines`);
  for (const violation of violations) {
    console.error(`${violation.lineCount.toString().padStart(5, " ")} ${violation.path}`);
  }
  process.exitCode = 1;
}

function parseRoots(argv) {
  const rootsArg = argv.find((arg) => arg.startsWith("--roots="));
  if (!rootsArg) return DEFAULT_ROOTS;
  return rootsArg
    .slice("--roots=".length)
    .split(",")
    .map((root) => root.trim())
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
