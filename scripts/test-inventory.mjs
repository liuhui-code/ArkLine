#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { matchesPath, normalizePath } from "./test-foundation-model.mjs";

const DEFAULT_REGISTRY = "docs/quality/capabilities.json";
const DEFAULT_REPORT = "artifacts/test-inventory.json";

export async function buildTestInventory({ rootPath, registryPath = DEFAULT_REGISTRY }) {
  const root = path.resolve(rootPath);
  const registry = JSON.parse(await readFile(path.resolve(root, registryPath), "utf8"));
  const candidates = await collectCandidateFiles(root);
  const tests = [];

  for (const filePath of candidates) {
    const absolutePath = path.join(root, filePath);
    const content = await readFile(absolutePath, "utf8");
    const runner = classifyRunner(filePath, content);
    if (!runner) continue;
    const capabilities = registry.capabilities
      .filter((capability) => capability.testPatterns.some((pattern) => matchesPath(filePath, pattern)))
      .map((capability) => capability.id);
    const domain = capabilities.length > 0
      ? registry.capabilities.find((capability) => capability.id === capabilities[0]).domain
      : inferDomain(filePath);
    const ignored = /#\[ignore(?:\s|=|\])/u.test(content);
    const size = inferSize(filePath, runner, ignored);
    tests.push({
      path: filePath,
      runner,
      domain,
      owner: ownerForDomain(domain),
      size,
      platform: inferPlatform(filePath),
      hermetic: !ignored && size !== "product",
      ignored,
      capabilities,
      mockCallAssertions: /toHaveBeenCalled/u.test(content),
    });
  }

  tests.sort((left, right) => left.path.localeCompare(right.path));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    summary: {
      totalFiles: tests.length,
      ignoredFiles: tests.filter((test) => test.ignored).length,
      mockCallAssertionFiles: tests.filter((test) => test.mockCallAssertions).length,
      unmappedCapabilityFiles: tests.filter((test) => test.capabilities.length === 0).length,
      byRunner: countBy(tests, "runner"),
      bySize: countBy(tests, "size"),
      byDomain: countBy(tests, "domain"),
    },
    tests,
  };
}

export async function writeTestInventory({ rootPath, registryPath, reportPath = DEFAULT_REPORT }) {
  const report = await buildTestInventory({ rootPath, registryPath });
  const output = path.resolve(rootPath, reportPath);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function collectCandidateFiles(root) {
  const roots = ["tests/frontend", "semantic-worker/src/__tests__", "src-tauri/src", "src-tauri/tests"];
  const files = [];
  for (const relativeRoot of roots) {
    await walk(path.join(root, relativeRoot), relativeRoot, files);
  }
  return files;
}

async function walk(absoluteDirectory, relativeDirectory, files) {
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = normalizePath(path.join(relativeDirectory, entry.name));
    if (entry.isDirectory()) {
      await walk(path.join(absoluteDirectory, entry.name), relativePath, files);
    } else if (/\.(?:rs|[cm]?[jt]sx?)$/u.test(entry.name)) {
      files.push(relativePath);
    }
  }
}

function classifyRunner(filePath, content) {
  if (filePath.startsWith("tests/frontend/") && /\.test\.(?:[cm]?[jt]sx?)$/u.test(filePath)) return "frontend";
  if (filePath.startsWith("semantic-worker/src/__tests__/") && /\.test\.[cm]?[jt]s$/u.test(filePath)) return "semantic-worker";
  if (filePath.startsWith("src-tauri/tests/") && filePath.endsWith(".rs") && /#\[(?:tokio::)?test\]/u.test(content)) return "rust-integration";
  if (filePath.startsWith("src-tauri/src/") && filePath.endsWith(".rs") && /#\[(?:tokio::)?test\]/u.test(content)) return "rust-unit";
  return null;
}

function inferSize(filePath, runner, ignored) {
  if (/packaged-soak|real-project|windows-exe|windows-package/u.test(filePath)) return "product";
  if (ignored || runner === "rust-integration" || /performance|perf-|soak/u.test(filePath)) return "large";
  if (filePath.endsWith(".tsx") || runner === "rust-unit") return "medium";
  return "small";
}

function inferDomain(filePath) {
  const rules = [
    ["build", /build/u],
    ["indexing", /index/u],
    ["git", /git|source-control/u],
    ["workspace", /workspace|project-tree/u],
    ["editor", /editor|document|code-action/u],
    ["search-navigation", /search|navigation|definition|usage|quick-open|symbol/u],
    ["semantic", /semantic|completion|language|type-engine|sdk/u],
    ["terminal", /terminal/u],
    ["device-log", /device-log|device_|fault-log/u],
    ["release", /package|release|quality|workflow|perf|soak|line-count|crash-boundary/u],
  ];
  return rules.find(([, pattern]) => pattern.test(filePath))?.[0] ?? "shared";
}

function ownerForDomain(domain) {
  return {
    build: "build-system",
    indexing: "indexing",
    git: "source-control",
    workspace: "workspace",
    editor: "editor",
    "search-navigation": "navigation",
    semantic: "language-services",
    terminal: "terminal",
    "device-log": "device-tools",
    release: "release-engineering",
    shared: "core-platform",
  }[domain];
}

function inferPlatform(filePath) {
  if (/windows/u.test(filePath)) return "windows";
  if (/mac(?:os)?/u.test(filePath)) return "macos";
  return "all";
}

function countBy(items, key) {
  return Object.fromEntries([...new Set(items.map((item) => item[key]))]
    .sort()
    .map((value) => [value, items.filter((item) => item[key] === value).length]));
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map((argument) => {
    const [key, value] = argument.replace(/^--/u, "").split("=");
    return [key, value ?? true];
  }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await writeTestInventory({
    rootPath: process.cwd(),
    registryPath: typeof args.registry === "string" ? args.registry : DEFAULT_REGISTRY,
    reportPath: typeof args.report === "string" ? args.report : DEFAULT_REPORT,
  });
  console.log(`ARKLINE_TEST_INVENTORY ${JSON.stringify(report.summary)}`);
}

const entryHref = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entryHref) await main();
