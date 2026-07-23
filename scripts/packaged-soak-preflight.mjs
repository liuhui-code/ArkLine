import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildFixtureRelativePath,
  PROFILE_FILE_COUNTS,
} from "./generate-performance-fixture.mjs";

const execFileAsync = promisify(execFile);
const MARKER_NAME = ".arkline-performance-fixture.json";

export async function inspectPackagedSoakPreflight(
  options,
  resolveTool = resolveWindowsTool,
) {
  const checks = [];
  const application = await inspectFile(options.applicationPath);
  const executable = path.extname(options.applicationPath).toLowerCase() === ".exe";
  checks.push(check(
    "application",
    application.ok && executable,
    executable ? application.detail : `${options.applicationPath} is not an .exe`,
  ));

  const fixture = await inspectFixtureMarker(options.fixturePath);
  checks.push(check("fixture-marker", fixture.ok, fixture.detail));
  if (fixture.marker?.fileCount > 0) {
    const lastIndex = fixture.marker.fileCount - 1;
    checks.push(await inspectFixtureProbe(options.fixturePath, 0, "fixture-first-file"));
    checks.push(
      await inspectFixtureProbe(
        options.fixturePath,
        lastIndex,
        "fixture-last-file",
      ),
    );
  }

  for (const [name, command] of [
    ["msedgedriver", options.driverPath],
    ["powershell", "powershell.exe"],
  ]) {
    const resolved = await resolveTool(command).catch(() => null);
    checks.push(check(name, Boolean(resolved), resolved ?? `${command} not found`));
  }

  return {
    capturedAt: Date.now(),
    passed: checks.every((item) => item.passed),
    checks,
    fixture: fixture.marker ?? null,
  };
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

async function inspectFixtureMarker(fixturePath) {
  try {
    const marker = JSON.parse(
      await readFile(path.join(fixturePath, MARKER_NAME), "utf8"),
    );
    const expectedCount = PROFILE_FILE_COUNTS[marker.profile];
    const valid = marker.version === 1
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

function check(name, passed, detail) {
  return { name, passed, detail };
}
