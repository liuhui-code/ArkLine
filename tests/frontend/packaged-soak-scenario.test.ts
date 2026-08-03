import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  findQueryForCycle,
  loadPackagedSoakScenario,
  quickOpenTargetForCycle,
} from "../../scripts/packaged-soak-scenario.mjs";
import { inspectPackagedSoakPreflight } from "../../scripts/packaged-soak-preflight.mjs";

describe("packaged soak scenario", () => {
  it("keeps the generated fixture sequence deterministic", async () => {
    const scenario = await loadPackagedSoakScenario({ scenarioPath: null });

    expect(findQueryForCycle(scenario, 12)).toBe("arklineSearchNeedle12");
    expect(quickOpenTargetForCycle(scenario, 2)).toEqual({
      query: "Page000194",
      title: "Page000194",
      editorNeedle: "Page000194",
    });
  });

  it("loads a pinned real-workspace scenario", async () => {
    const root = path.join(os.tmpdir(), `arkline-scenario-${Date.now()}`);
    const scenarioPath = path.join(root, "core-loop.json");
    await mkdir(root, { recursive: true });
    await writeFile(scenarioPath, JSON.stringify({
      schemaVersion: 2,
      kind: "real-workspace",
      revision: "0123456789abcdef",
      sdkIdentity: "OpenHarmony-6.0/API-20",
      repository: {
        url: "https://github.com/example/harmony-app.git",
        license: "MIT",
      },
      findQueries: ["@Entry", "build()"],
      quickOpenTargets: [
        {
          query: "EntryAbility",
          title: "EntryAbility.ets",
          editorNeedle: "EntryAbility",
        },
        { query: "Index", title: "Index.ets", editorNeedle: "struct Index" },
      ],
      definitionTargets: [{
        source: { query: "Index", title: "Index.ets", editorNeedle: "struct Index" },
        token: "PageModel",
        occurrence: 1,
        target: { title: "PageModel.ets", editorNeedle: "class PageModel" },
      }],
      completionTargets: [{
        source: { query: "Index", title: "Index.ets", editorNeedle: "struct Index" },
        lineNeedle: "this.model.refresh()",
        cursorAfter: "this.model.",
        expectedLabels: ["refresh"],
      }],
    }));

    try {
      const scenario = await loadPackagedSoakScenario({ scenarioPath });
      expect(scenario).toMatchObject({
        kind: "real-workspace",
        revision: "0123456789abcdef",
        sdkIdentity: "OpenHarmony-6.0/API-20",
      });
      expect(findQueryForCycle(scenario, 3)).toBe("build()");
      expect(quickOpenTargetForCycle(scenario, 3)).toEqual({
        query: "Index",
        title: "Index.ets",
        editorNeedle: "struct Index",
      });
      expect(scenario.definitionTargets[0].target.title).toBe("PageModel.ets");
      expect(scenario.completionTargets[0].expectedLabels).toEqual(["refresh"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a real workspace without a pinned revision", async () => {
    const root = path.join(os.tmpdir(), `arkline-scenario-invalid-${Date.now()}`);
    const scenarioPath = path.join(root, "core-loop.json");
    await mkdir(root, { recursive: true });
    await writeFile(scenarioPath, JSON.stringify({
      schemaVersion: 2,
      kind: "real-workspace",
      revision: "",
      findQueries: ["build"],
      quickOpenTargets: [
        { query: "Index", title: "Index.ets", editorNeedle: "struct Index" },
      ],
    }));

    try {
      await expect(loadPackagedSoakScenario({ scenarioPath }))
        .rejects.toThrow("revision");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts an explicit real workspace without a synthetic marker", async () => {
    const root = path.join(os.tmpdir(), `arkline-real-workspace-${Date.now()}`);
    const applicationPath = path.join(root, "ArkLine.exe");
    const fixturePath = path.join(root, "workspace");
    const scenarioPath = path.join(root, "core-loop.json");
    const sdkPath = path.join(root, "sdk");
    await mkdir(fixturePath, { recursive: true });
    await mkdir(sdkPath, { recursive: true });
    await writeFile(applicationPath, "exe");
    await writeFile(scenarioPath, JSON.stringify({
      revision: "0123456789abcdef",
      repository: { url: "https://github.com/example/harmony-app.git" },
    }));

    try {
      const preflight = await inspectPackagedSoakPreflight({
        applicationPath,
        fixturePath,
        scenarioPath,
        sdkPath,
        driverPath: "msedgedriver",
      }, async (tool: string) => tool, async () => ({
        revision: "0123456789abcdef",
        repositoryUrl: "git@github.com:example/harmony-app.git",
      }));
      expect(preflight.passed).toBe(true);
      expect(preflight.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "workspace-directory", passed: true }),
        expect.objectContaining({ name: "scenario", passed: true }),
        expect.objectContaining({ name: "workspace-revision", passed: true }),
        expect.objectContaining({ name: "workspace-repository", passed: true }),
        expect.objectContaining({ name: "sdk-directory", passed: true }),
      ]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
