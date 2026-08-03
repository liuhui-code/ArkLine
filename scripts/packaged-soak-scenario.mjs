import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SCENARIO_VERSION = 2;

export async function loadPackagedSoakScenario(options) {
  if (!options.scenarioPath) {
    return {
      schemaVersion: SCENARIO_VERSION,
      kind: "generated",
      revision: null,
      sourcePath: null,
      sha256: null,
      findQueries: [],
      quickOpenTargets: [],
      definitionTargets: [],
      completionTargets: [],
    };
  }
  const sourcePath = path.resolve(options.scenarioPath);
  const source = await readFile(sourcePath, "utf8");
  const scenario = JSON.parse(source);
  validateRealWorkspaceScenario(scenario);
  return {
    ...scenario,
    sourcePath,
    sha256: createHash("sha256").update(source).digest("hex"),
  };
}

export function findQueryForCycle(scenario, cycle) {
  if (scenario.kind === "generated") {
    return `arklineSearchNeedle${cycle % 1000}`;
  }
  return scenario.findQueries[cycle % scenario.findQueries.length];
}

export function quickOpenTargetForCycle(scenario, cycle) {
  if (scenario.kind === "generated") {
    const pageIndex = (cycle * 97) % 1000;
    const pageName = `Page${String(pageIndex).padStart(6, "0")}`;
    return { query: pageName, title: pageName, editorNeedle: pageName };
  }
  return scenario.quickOpenTargets[cycle % scenario.quickOpenTargets.length];
}

export function definitionTargetForCycle(scenario, cycle) {
  return scenario.definitionTargets?.[cycle % scenario.definitionTargets.length] ?? null;
}

export function completionTargetForCycle(scenario, cycle) {
  return scenario.completionTargets?.[cycle % scenario.completionTargets.length] ?? null;
}

function validateRealWorkspaceScenario(scenario) {
  if (scenario?.schemaVersion !== SCENARIO_VERSION) {
    throw new Error(`scenario schemaVersion must be ${SCENARIO_VERSION}`);
  }
  if (scenario.kind !== "real-workspace") {
    throw new Error("scenario kind must be real-workspace");
  }
  if (typeof scenario.revision !== "string" || !scenario.revision.trim()) {
    throw new Error("real-workspace scenario revision is required");
  }
  if (typeof scenario.sdkIdentity !== "string" || !scenario.sdkIdentity.trim()) {
    throw new Error("real-workspace scenario sdkIdentity is required");
  }
  if (!validRepository(scenario.repository)) {
    throw new Error("real-workspace scenario repository is invalid");
  }
  if (!validStrings(scenario.findQueries)) {
    throw new Error("real-workspace scenario findQueries must be non-empty strings");
  }
  if (!validQuickOpenTargets(scenario.quickOpenTargets)) {
    throw new Error("real-workspace scenario quickOpenTargets are invalid");
  }
  if (!validDefinitionTargets(scenario.definitionTargets)) {
    throw new Error("real-workspace scenario definitionTargets are invalid");
  }
  if (!validCompletionTargets(scenario.completionTargets)) {
    throw new Error("real-workspace scenario completionTargets are invalid");
  }
}

function validStrings(values) {
  return Array.isArray(values)
    && values.length > 0
    && values.every((value) => typeof value === "string" && value.trim());
}

function validRepository(repository) {
  return typeof repository?.url === "string"
    && repository.url.startsWith("https://")
    && typeof repository?.license === "string"
    && Boolean(repository.license.trim());
}

function validQuickOpenTarget(target) {
  return typeof target?.query === "string"
    && Boolean(target.query.trim())
    && typeof target?.title === "string"
    && Boolean(target.title.trim())
    && typeof target?.editorNeedle === "string"
    && Boolean(target.editorNeedle.trim());
}

function validQuickOpenTargets(targets) {
  return Array.isArray(targets)
    && targets.length > 0
    && targets.every(validQuickOpenTarget);
}

function validDefinitionTargets(targets) {
  return Array.isArray(targets)
    && targets.length > 0
    && targets.every((target) => (
      validQuickOpenTarget(target?.source)
      && typeof target?.token === "string"
      && Boolean(target.token.trim())
      && Number.isInteger(target?.occurrence)
      && target.occurrence > 0
      && typeof target?.target?.title === "string"
      && Boolean(target.target.title.trim())
      && typeof target?.target?.editorNeedle === "string"
      && Boolean(target.target.editorNeedle.trim())
    ));
}

function validCompletionTargets(targets) {
  return Array.isArray(targets)
    && targets.length > 0
    && targets.every((target) => (
      validQuickOpenTarget(target?.source)
      && typeof target?.lineNeedle === "string"
      && Boolean(target.lineNeedle.trim())
      && typeof target?.cursorAfter === "string"
      && Boolean(target.cursorAfter.trim())
      && target.lineNeedle.includes(target.cursorAfter)
      && validStrings(target.expectedLabels)
      && (target.forbiddenLabels === undefined || validStrings(target.forbiddenLabels))
    ));
}
