import { useEffect, useMemo, useRef, useState } from "react";
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
import type { BuildState, BuildTarget } from "@/features/build/build-model";
import { parseBuildProfileProducts } from "@/features/build/build-profile-parser";
import { detectHarmonyBuildProject, inferBuildModuleForPath } from "@/features/build/build-project-detector";
import { preflightHarmonyBuild } from "@/features/build/build-preflight";
import { createBuildStore } from "@/features/build/build-store";
import type { ProblemItem } from "@/features/problems/problems-store";
import type { AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";
import { getPathBasename } from "@/features/workspace/workspace-store";

export type UseBuildControllerStateOptions = {
  workspace: WorkspaceViewModel | null;
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  selectedProjectPath: string | null;
  sdkSettings: AppSettings["sdk"];
  showBuild: () => void;
  replaceBuildProblems: (problems: ProblemItem[]) => void;
  onStatusChange: (message: string) => void;
};

export function useBuildControllerState({
  workspace,
  workspaceApi,
  activePath,
  selectedProjectPath,
  sdkSettings,
  showBuild,
  replaceBuildProblems,
  onStatusChange,
}: UseBuildControllerStateOptions) {
  const buildStoreRef = useRef(createBuildStore());
  const buildRunCounterRef = useRef(0);
  const [buildState, setBuildState] = useState(() => ({ ...buildStoreRef.current.state }));
  const buildProject = useMemo(
    () => workspace ? detectHarmonyBuildProject(workspace.rootPath, workspace.visibleFiles) : null,
    [workspace],
  );
  const buildProfilePath = useMemo(
    () => workspace?.visibleFiles.find((path) => getPathBasename(path) === "build-profile.json5") ?? null,
    [workspace],
  );

  function syncBuildState() {
    setBuildState({ ...buildStoreRef.current.state });
  }

  useEffect(() => {
    const nextModule = inferBuildModuleForPath(buildProject, selectedProjectPath ?? activePath);
    if (!nextModule || buildStoreRef.current.state.status === "running") {
      return;
    }
    if (buildStoreRef.current.state.moduleName !== nextModule) {
      buildStoreRef.current.configure({ moduleName: nextModule });
      syncBuildState();
    }
  }, [activePath, buildProject, selectedProjectPath]);

  useEffect(() => {
    if (!buildProfilePath) {
      buildStoreRef.current.configure({ products: ["default"], product: "default" });
      syncBuildState();
      return;
    }

    let cancelled = false;
    void workspaceApi.openFile(buildProfilePath).then((content) => {
      if (cancelled) {
        return;
      }

      const products = parseBuildProfileProducts(content);
      const currentProduct = buildStoreRef.current.state.product;
      const product = products.includes(currentProduct)
        ? currentProduct
        : products.includes("default") ? "default" : products[0];
      buildStoreRef.current.configure({ products, product });
      syncBuildState();
    });

    return () => {
      cancelled = true;
    };
  }, [buildProfilePath, workspaceApi]);

  function updateBuildState(next: Partial<Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">>) {
    buildStoreRef.current.configure(next);
    syncBuildState();
  }

  async function loadBuildConfigurationsForRoot(rootPath: string) {
    const configurations = await workspaceApi.loadBuildConfigurations?.(rootPath) ?? [];
    buildStoreRef.current.loadConfigurations(configurations);
    syncBuildState();
  }

  async function persistBuildConfigurations() {
    if (!workspace?.rootPath) {
      return;
    }

    try {
      await workspaceApi.saveBuildConfigurations?.(workspace.rootPath, buildStoreRef.current.state.configurations);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onStatusChange(`Save build configuration failed: ${message}`);
    }
  }

  async function saveBuildConfiguration() {
    buildStoreRef.current.saveCurrentConfiguration();
    syncBuildState();
    showBuild();
    await persistBuildConfigurations();
  }

  async function copyBuildConfiguration() {
    buildStoreRef.current.copyActiveConfiguration();
    syncBuildState();
    showBuild();
    await persistBuildConfigurations();
  }

  async function deleteBuildConfiguration() {
    buildStoreRef.current.deleteActiveConfiguration();
    syncBuildState();
    showBuild();
    await persistBuildConfigurations();
  }

  function selectBuildConfiguration(configurationId: string) {
    buildStoreRef.current.selectConfiguration(configurationId);
    syncBuildState();
  }

  async function runBuild(clean = false) {
    if (!workspace?.rootPath) {
      buildStoreRef.current.fail("Open a project before building");
      syncBuildState();
      showBuild();
      return;
    }

    if (buildStoreRef.current.state.status === "running") {
      showBuild();
      return;
    }

    const state = buildStoreRef.current.state;
    const preflight = preflightHarmonyBuild({
      project: buildProject,
      settings: sdkSettings,
      target: state.lastTarget,
      moduleName: state.lastTarget === "app" ? null : state.moduleName,
    });
    if (!preflight.canBuild) {
      buildStoreRef.current.failPreflight(preflight);
      syncBuildState();
      showBuild();
      onStatusChange("Build preflight failed");
      return;
    }

    const plan = createHarmonyBuildPlanFromState({
      rootPath: workspace.rootPath,
      state,
      clean,
      project: buildProject,
    });
    buildRunCounterRef.current += 1;
    const runId = `build-${buildRunCounterRef.current}`;

    buildStoreRef.current.start({ ...plan, runId });
    syncBuildState();
    showBuild();
    onStatusChange(plan.label);

    try {
      const buildResult = await executeHarmonyBuildPlan({
        runId,
        plan,
        runTerminalCommand: workspaceApi.runTerminalCommand,
        settings: sdkSettings,
      });
      buildStoreRef.current.finish(buildResult);
      replaceBuildProblems(buildResult.diagnostics);
      syncBuildState();
      onStatusChange(buildStoreRef.current.state.message);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      buildStoreRef.current.fail(message);
      syncBuildState();
      onStatusChange("Build failed");
    }
  }

  async function stopBuild() {
    const runId = buildStoreRef.current.state.currentRun?.runId;
    if (!runId) {
      return;
    }

    await workspaceApi.stopTerminalCommand(runId);
    onStatusChange("Stopping build");
  }

  return {
    buildState,
    buildProject,
    loadBuildConfigurationsForRoot,
    updateBuildState,
    saveBuildConfiguration,
    copyBuildConfiguration,
    deleteBuildConfiguration,
    selectBuildConfiguration,
    runBuild,
    stopBuild,
  };
}
