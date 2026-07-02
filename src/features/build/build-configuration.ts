import type { BuildConfiguration, BuildState } from "@/features/build/build-model";

export type BuildConfigurationInput = Pick<BuildState, "lastTarget" | "moduleName" | "product" | "buildMode" | "fastMode">;

export function buildConfigurationName(input: BuildConfigurationInput): string {
  const target = input.lastTarget.toUpperCase();
  const moduleName = input.lastTarget === "app" ? "project" : input.moduleName.trim() || "entry";
  return `${target} ${moduleName} ${input.buildMode}`;
}

export function createBuildConfiguration(input: BuildConfigurationInput): BuildConfiguration {
  const name = buildConfigurationName(input);
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
    target: input.lastTarget,
    moduleName: input.moduleName.trim() || "entry",
    product: input.product.trim() || "default",
    buildMode: input.buildMode,
    fastMode: input.fastMode,
  };
}

export function buildConfigurationMatchesState(configuration: BuildConfiguration, state: BuildConfigurationInput): boolean {
  return configuration.target === state.lastTarget
    && configuration.moduleName === (state.moduleName.trim() || "entry")
    && configuration.product === (state.product.trim() || "default")
    && configuration.buildMode === state.buildMode
    && configuration.fastMode === state.fastMode;
}

export function copyBuildConfiguration(configuration: BuildConfiguration, existing: BuildConfiguration[]): BuildConfiguration {
  const baseName = `${configuration.name} copy`;
  const existingNames = new Set(existing.map((item) => item.name));
  let name = baseName;
  let suffix = 2;
  while (existingNames.has(name)) {
    name = `${baseName} ${suffix}`;
    suffix += 1;
  }

  return {
    ...configuration,
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    name,
  };
}
