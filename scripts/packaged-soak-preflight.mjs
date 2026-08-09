import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildFixtureRelativePath,
  FIXTURE_VERSION,
  PROFILE_FILE_COUNTS,
} from "./generate-performance-fixture.mjs";

const execFileAsync = promisify(execFile);
const MARKER_NAME = ".arkline-performance-fixture.json";

export async function inspectPackagedSoakPreflight(
  options,
  resolveTool = resolveWindowsTool,
  inspectWorkspace = inspectGitWorkspace,
) {
  const checks = [];
  const application = await inspectFile(options.applicationPath);
  const executable = path.extname(options.applicationPath).toLowerCase() === ".exe";
  checks.push(check(
    "application",
    application.ok && executable,
    executable ? application.detail : `${options.applicationPath} is not an .exe`,
  ));

  const fixture = options.scenarioPath
    ? await inspectRealWorkspace(options, checks, inspectWorkspace)
    : await inspectGeneratedFixture(options, checks);

  const driver = await resolveTool(options.driverPath).catch(() => null);
  checks.push(check(
    "msedgedriver",
    Boolean(driver),
    driver ?? `${options.driverPath} not found`,
  ));
  const powerShell = await resolveWindowsPowerShell(resolveTool).then(
    (resolved) => ({ resolved, error: null }),
    (error) => ({ resolved: null, error: errorMessage(error) }),
  );
  checks.push(check(
    "powershell",
    Boolean(powerShell.resolved),
    powerShell.resolved ?? powerShell.error,
  ));

  return {
    capturedAt: Date.now(),
    passed: checks.every((item) => item.passed),
    checks,
    fixture: fixture.marker ?? null,
  };
}

async function inspectGeneratedFixture(options, checks) {
  const fixture = await inspectFixtureMarker(options.fixturePath);
  checks.push(check("fixture-marker", fixture.ok, fixture.detail));
  if (fixture.marker?.fileCount > 0) {
    const lastIndex = fixture.marker.fileCount - 1;
    checks.push(await inspectFixtureProbe(options.fixturePath, 0, "fixture-first-file"));
    checks.push(await inspectFixtureProbe(
      options.fixturePath,
      lastIndex,
      "fixture-last-file",
    ));
  }
  return fixture;
}

async function inspectRealWorkspace(options, checks, inspectWorkspace) {
  const workspace = await inspectDirectory(options.fixturePath);
  checks.push(check("workspace-directory", workspace.ok, workspace.detail));
  const scenario = await inspectFile(options.scenarioPath);
  checks.push(check("scenario", scenario.ok, scenario.detail));
  const manifest = scenario.ok ? await readScenario(options.scenarioPath) : null;
  const git = workspace.ok ? await inspectWorkspace(options.fixturePath) : null;
  const revisionMatches = Boolean(
    manifest?.revision
    && git?.revision
    && manifest.revision.toLowerCase() === git.revision.toLowerCase(),
  );
  checks.push(check(
    "workspace-revision",
    revisionMatches,
    revisionMatches
      ? git.revision
      : git?.error ?? `${git?.revision ?? "missing"} != ${manifest?.revision ?? "missing"}`,
  ));
  const repositoryMatches = sameRepositoryUrl(
    git?.repositoryUrl,
    manifest?.repository?.url,
  );
  checks.push(check(
    "workspace-repository",
    repositoryMatches,
    git?.repositoryUrl ?? git?.error ?? "missing remote.origin.url",
  ));
  const sdk = options.sdkPath
    ? await inspectDirectory(options.sdkPath)
    : { ok: false, detail: "--sdk is required for real-workspace scenarios" };
  checks.push(check("sdk-directory", sdk.ok, sdk.detail));
  return {
    ok: workspace.ok && scenario.ok && revisionMatches && repositoryMatches && sdk.ok,
    detail: workspace.detail,
    marker: null,
  };
}

async function readScenario(scenarioPath) {
  try {
    return JSON.parse(await readFile(scenarioPath, "utf8"));
  } catch {
    return null;
  }
}

async function inspectGitWorkspace(workspacePath) {
  try {
    const [revision, repositoryUrl] = await Promise.all([
      execFileAsync("git", ["-C", workspacePath, "rev-parse", "HEAD"]),
      execFileAsync("git", ["-C", workspacePath, "config", "--get", "remote.origin.url"]),
    ]);
    return {
      revision: revision.stdout.trim(),
      repositoryUrl: repositoryUrl.stdout.trim(),
    };
  } catch (error) {
    return { error: String(error) };
  }
}

function sameRepositoryUrl(actual, expected) {
  if (!actual || !expected) return false;
  return normalizeRepositoryUrl(actual) === normalizeRepositoryUrl(expected);
}

function normalizeRepositoryUrl(value) {
  return value
    .trim()
    .replace(/^git@github\.com:/iu, "https://github.com/")
    .replace(/\.git$/iu, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

export async function resolveWindowsTool(command) {
  if (path.win32.isAbsolute(command) || /[\\/]/u.test(command)) {
    const result = await inspectFile(command);
    if (!result.ok) throw new Error(result.detail);
    return command;
  }
  const { stdout } = await execFileAsync(
    "where.exe",
    [command],
    { windowsHide: true, timeout: 5_000 },
  );
  const resolved = stdout
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find(Boolean);
  if (!resolved) throw new Error(`${command} not found`);
  return resolved;
}

export async function resolveWindowsPowerShell(
  resolveTool = resolveWindowsTool,
  environment = process.env,
) {
  const failures = [];
  for (const candidate of powerShellCandidates(environment)) {
    try {
      return await resolveTool(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${errorMessage(error)}`);
    }
  }
  throw new Error([
    "PowerShell resolution failed",
    `attempted=${failures.join(" | ") || "none"}`,
    `ARKLINE_POWERSHELL_PATH=${environment.ARKLINE_POWERSHELL_PATH ?? "unset"}`,
    `PSModulePath=${truncateDiagnostic(environment.PSModulePath)}`,
    `PATH=${truncateDiagnostic(environment.PATH)}`,
  ].join("; "));
}

function powerShellCandidates(environment) {
  const programFiles = [
    environment.ProgramW6432,
    environment.ProgramFiles,
    environment["ProgramFiles(x86)"],
  ];
  const systemRoots = [environment.SystemRoot, environment.windir];
  return uniqueCandidates([
    environment.ARKLINE_POWERSHELL_PATH,
    ...powerShellPathsFromModulePath(environment.PSModulePath),
    ...programFiles.map((root) => root && path.win32.join(root, "PowerShell", "7", "pwsh.exe")),
    ...systemRoots.map((root) => root && path.win32.join(
      root,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    )),
    "powershell.exe",
    "pwsh.exe",
  ]);
}

function powerShellPathsFromModulePath(modulePath) {
  if (!modulePath) return [];
  return modulePath.split(";").flatMap((entry) => {
    const modulesPath = entry.trim();
    if (!modulesPath) return [];
    const hostPath = path.win32.dirname(modulesPath);
    const executable = path.win32.basename(hostPath).toLowerCase() === "v1.0"
      ? "powershell.exe"
      : "pwsh.exe";
    return [path.win32.join(hostPath, executable)];
  });
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate) return false;
    const key = candidate.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function truncateDiagnostic(value) {
  if (!value) return "unset";
  return value.length > 2_000 ? `${value.slice(0, 2_000)}...` : value;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function inspectFixtureMarker(fixturePath) {
  try {
    const marker = JSON.parse(
      await readFile(path.join(fixturePath, MARKER_NAME), "utf8"),
    );
    const expectedCount = PROFILE_FILE_COUNTS[marker.profile];
    const valid = marker.version === FIXTURE_VERSION
      && Number.isInteger(expectedCount)
      && marker.fileCount === expectedCount;
    return {
      ok: valid,
      detail: valid
        ? `${marker.profile}:${marker.fileCount}`
        : "invalid fixture marker",
      marker,
    };
  } catch (error) {
    return { ok: false, detail: String(error), marker: null };
  }
}

async function inspectFixtureProbe(fixturePath, index, name) {
  const relativePath = buildFixtureRelativePath(index);
  const result = await inspectFile(path.join(fixturePath, relativePath));
  return check(name, result.ok, result.ok ? relativePath : result.detail);
}

async function inspectFile(filePath) {
  try {
    const metadata = await stat(filePath);
    return metadata.isFile()
      ? { ok: true, detail: filePath }
      : { ok: false, detail: `${filePath} is not a file` };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

async function inspectDirectory(directoryPath) {
  try {
    const metadata = await stat(directoryPath);
    return metadata.isDirectory()
      ? { ok: true, detail: directoryPath }
      : { ok: false, detail: `${directoryPath} is not a directory` };
  } catch (error) {
    return { ok: false, detail: String(error) };
  }
}

function check(name, passed, detail) {
  return { name, passed, detail };
}
