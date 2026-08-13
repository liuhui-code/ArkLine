import { useEffect, useMemo, useRef, useState } from "react";
import { createHarmonyBuildPlanFromState, executeHarmonyBuildPlan } from "@/features/build/build-controller";
import type { BuildState, BuildTarget, HarmonyBuildProject } from "@/features/build/build-model";
import { parseBuildProfileModules, parseBuildProfileProducts } from "@/features/build/build-profile-parser";
import { detectHarmonyBuildProject, inferBuildModuleForPath } from "@/features/build/build-project-detector";
import { preflightHarmonyBuild } from "@/features/build/build-preflight";
import { createBuildStore } from "@/features/build/build-store";
import type { ProblemItem } from "@/features/problems/problems-store";
import type { AppSettings } from "@/features/settings/settings-store";
import type { WorkspaceApi, WorkspaceViewModel } from "@/features/workspace/workspace-api";

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
  const buildConfigurationPersistenceRef = useRef(Promise.resolve());
  const buildConfigurationLoadCounterRef = useRef(0);
  const loadedBuildConfigurationRootRef = useRef<string | null>(null);
  const [buildState, setBuildState] = useState(() => ({ ...buildStoreRef.current.state }));
  const visibleBuildProject = useMemo(
    () => workspace ? detectHarmonyBuildProject(workspace.rootPath, workspace.visibleFiles) : null,
    [workspace],
  );
  const [inspectedBuildProject, setInspectedBuildProject] = useState<HarmonyBuildProject | null>(null);
  const [profileModules, setProfileModules] = useState<string[]>([]);
  const buildInspectionPath = selectedProjectPath ?? workspace?.rootPath ?? null;
  const baseBuildProject = inspectedBuildProject && isBuildProjectInWorkspace(inspectedBuildProject, workspace)
    ? inspectedBuildProject
    : visibleBuildProject;
  const buildProject = useMemo(() => {
    if (!baseBuildProject || profileModules.length === 0) {
      return baseBuildProject;
    }
    const modules = Array.from(new Set([...baseBuildProject.modules, ...profileModules])).sort();
    return modules.length === baseBuildProject.modules.length
      ? baseBuildProject
      : { ...baseBuildProject, modules, defaultModule: modules.includes("entry") ? "entry" : modules[0] ?? null };
  }, [baseBuildProject, profileModules]);
  const buildProfilePath = useMemo(
    () => buildProject?.hasBuildProfile ? `${buildProject.rootPath}/build-profile.json5` : null,
    [buildProject],
  );

  useEffect(() => {
    if (!buildProject?.isHarmonyProject || !workspaceApi.loadBuildConfigurations) {
      return;
    }
    const rootPath = normalizeComparablePath(buildProject.rootPath);
    if (loadedBuildConfigurationRootRef.current === rootPath) {
      return;
    }
    void loadBuildConfigurationsForRoot(buildProject.rootPath);
  }, [buildProject?.isHarmonyProject, buildProject?.rootPath, workspaceApi]);

  useEffect(() => {
    if (!workspace?.rootPath || !buildInspectionPath || !workspaceApi.inspectHarmonyBuildProject) {
      setInspectedBuildProject(null);
      return;
    }

    let cancelled = false;
    void workspaceApi.inspectHarmonyBuildProject(buildInspectionPath)
      .then((project) => {
        if (!cancelled) {
          setInspectedBuildProject(project.isHarmonyProject || !visibleBuildProject?.isHarmonyProject ? project : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setInspectedBuildProject(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [buildInspectionPath, visibleBuildProject?.isHarmonyProject, workspace?.rootPath, workspaceApi]);

  function syncBuildState() {
    setBuildState({ ...buildStoreRef.current.state });
  }

  async function resolveBuildEnvironment(rootPath: string, notify = false) {
    if (!workspaceApi.resolveBuildEnvironment) {
      buildStoreRef.current.setEnvironment(null);
      syncBuildState();
      return null;
    }
    try {
      const environment = await workspaceApi.resolveBuildEnvironment({
        rootPath,
        harmonySdkPath: sdkSettings.harmonySdkPath,
        nodePath: sdkSettings.nodePath,
        autoDetect: sdkSettings.autoDetect,
      });
      buildStoreRef.current.setEnvironment(environment);
      syncBuildState();
      return environment;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const failedEnvironment = {
        canBuild: false,
        hvigorCommand: null,
        hvigorSource: null,
        nodePath: null,
        sdkPath: null,
        pathEntries: [],
        environment: {},
        checks: [{ name: "hvigor", available: false, detail: `Environment resolver failed: ${detail}` }],
      };
      buildStoreRef.current.setEnvironment(failedEnvironment);
      syncBuildState();
      if (notify) {
        onStatusChange(`Build environment detection failed: ${detail}`);
      }
      return failedEnvironment;
    }
  }

  useEffect(() => {
    if (!buildProject?.isHarmonyProject || buildStoreRef.current.state.status === "running") {
      return;
    }
    void resolveBuildEnvironment(buildProject.rootPath);
  }, [buildProject?.isHarmonyProject, buildProject?.rootPath, sdkSettings.autoDetect, sdkSettings.harmonySdkPath, sdkSettings.nodePath]);

  useEffect(() => {
    if (!buildProject || buildStoreRef.current.state.status === "running" || buildStoreRef.current.state.activeConfigurationId) {
      return;
    }
    const selection = projectBuildSelection(
      buildProject,
      buildStoreRef.current.state,
      selectedProjectPath ?? activePath,
    );
    if (Object.keys(selection).length > 0) {
      buildStoreRef.current.configure(selection);
      syncBuildState();
    }
  }, [activePath, buildProject, selectedProjectPath]);

  useEffect(() => {
    setProfileModules([]);
  }, [baseBuildProject?.rootPath]);

  useEffect(() => {
    if (!buildProfilePath) {
      setProfileModules([]);
      const currentProduct = buildStoreRef.current.state.product.trim() || "default";
      buildStoreRef.current.configure({ products: [currentProduct], product: currentProduct });
      syncBuildState();
      return;
    }

    let cancelled = false;
    void workspaceApi.openFile(buildProfilePath).then((content) => {
      if (cancelled) {
        return;
      }

      const products = parseBuildProfileProducts(content);
      setProfileModules(parseBuildProfileModules(content));
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
    const loadId = ++buildConfigurationLoadCounterRef.current;
    const configurations = await workspaceApi.loadBuildConfigurations?.(rootPath) ?? [];
    if (loadId !== buildConfigurationLoadCounterRef.current) {
      return;
    }
    loadedBuildConfigurationRootRef.current = normalizeComparablePath(rootPath);
    buildStoreRef.current.loadConfigurations(configurations);
    syncBuildState();
  }

  async function persistBuildConfigurations() {
    const rootPath = buildProject?.isHarmonyProject ? buildProject.rootPath : workspace?.rootPath;
    if (!rootPath || !workspaceApi.saveBuildConfigurations) {
      return;
    }

    const configurations = [...buildStoreRef.current.state.configurations];
    const write = async () => {
      try {
        await workspaceApi.saveBuildConfigurations?.(rootPath, configurations);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onStatusChange(`Save build configuration failed: ${message}`);
      }
    };
    buildConfigurationPersistenceRef.current = buildConfigurationPersistenceRef.current.then(write, write);
    await buildConfigurationPersistenceRef.current;
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
    void persistBuildConfigurations();
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

    const projectInspectionPath = selectedProjectPath ?? activePath ?? workspace.rootPath;
    const project = workspaceApi.inspectHarmonyBuildProject
      ? await resolveBuildProject(projectInspectionPath)
      : buildProject;
    if (project) {
      const selection = projectBuildSelection(
        project,
        buildStoreRef.current.state,
        selectedProjectPath ?? activePath,
      );
      if (Object.keys(selection).length > 0) {
        buildStoreRef.current.configure(selection);
      }
      syncBuildState();
    }
    const state = buildStoreRef.current.state;
    const toolchain = await resolveBuildEnvironment(project?.rootPath ?? workspace.rootPath, true);
    const preflight = preflightHarmonyBuild({
      project,
      settings: sdkSettings,
      target: state.lastTarget,
      moduleName: state.lastTarget === "app" ? null : state.moduleName,
      product: state.product,
      environment: toolchain,
    });
    if (!preflight.canBuild) {
      buildStoreRef.current.failPreflight(preflight);
      syncBuildState();
      showBuild();
      onStatusChange("Build preflight failed");
      return;
    }

    const plan = createHarmonyBuildPlanFromState({
      rootPath: project?.rootPath ?? workspace.rootPath,
      state,
      clean,
      project,
      toolchain,
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
        toolchain,
        findBuildArtifacts: workspaceApi.findHarmonyBuildArtifacts
          ? () => workspaceApi.findHarmonyBuildArtifacts!(
            plan.intent.projectRoot,
            plan.intent.target,
            plan.intent.moduleName,
            plan.intent.product,
          )
          : undefined,
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

  async function resolveBuildProject(rootPath: string) {
    if (!workspaceApi.inspectHarmonyBuildProject) {
      return buildProject;
    }
    try {
      const project = await workspaceApi.inspectHarmonyBuildProject(rootPath);
      if (project.isHarmonyProject || !buildProject?.isHarmonyProject) {
        setInspectedBuildProject(project);
        return project;
      }
      return buildProject;
    } catch {
      return buildProject;
    }
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

function isBuildProjectInWorkspace(project: HarmonyBuildProject, workspace: WorkspaceViewModel | null) {
  if (!workspace?.rootPath) {
    return false;
  }
  const workspaceRoot = normalizeComparablePath(workspace.rootPath);
  const projectRoot = normalizeComparablePath(project.rootPath);
  return projectRoot === workspaceRoot || projectRoot.startsWith(`${workspaceRoot}/`);
}

function normalizeComparablePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "");
}

function projectBuildSelection(
  project: HarmonyBuildProject,
  state: Pick<BuildState, "moduleName" | "products" | "product">,
  selectedPath: string | null,
): Partial<Pick<BuildState, "moduleName" | "products" | "product">> {
  const selection: Partial<Pick<BuildState, "moduleName" | "products" | "product">> = {};
  const moduleName = inferBuildModuleForPath(project, selectedPath);
  if (moduleName && moduleName !== state.moduleName) {
    selection.moduleName = moduleName;
  }
  const products = project.products;
  if (products.length === 0) {
    return selection;
  }
  if (products.length !== state.products.length || products.some((product, index) => product !== state.products[index])) {
    selection.products = products;
  }
  if (!products.includes(state.product)) {
    selection.product = project.defaultProduct && products.includes(project.defaultProduct)
      ? project.defaultProduct
      : products[0];
  }
  return selection;
}
