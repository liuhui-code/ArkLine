import type {
  LanguageServiceCapability,
  LanguageServiceReport,
  WorkspaceApi,
} from "@/features/workspace/workspace-api";

export type SemanticMode = LanguageServiceReport["mode"];

export type SemanticState = {
  provider: string;
  mode: SemanticMode;
  detail: string;
  capabilities?: LanguageServiceCapability[];
  supervisor?: LanguageServiceReport["supervisor"];
};

export const defaultSemanticState: SemanticState = {
  provider: "unknown",
  mode: "unavailable",
  detail: "Semantic provider state has not been loaded yet.",
  capabilities: [],
  supervisor: undefined,
};

export async function loadSemanticState(workspaceApi: WorkspaceApi): Promise<SemanticState> {
  if (!workspaceApi.inspectLanguageService) {
    return {
      provider: "unavailable",
      mode: "unavailable",
      detail: "Language service inspection is unavailable in this shell.",
      capabilities: [],
      supervisor: undefined,
    };
  }

  const report = await workspaceApi.inspectLanguageService();
  return {
    provider: report.provider,
    mode: report.mode,
    detail: report.detail,
    capabilities: report.capabilities ?? legacyCapabilities(report),
    supervisor: report.supervisor,
  };
}

function legacyCapabilities(report: LanguageServiceReport): LanguageServiceCapability[] {
  const capabilities: LanguageServiceCapability[] = [];
  if (report.hover) capabilities.push("hover");
  if (report.definition) capabilities.push("definition");
  if (report.completion) capabilities.push("completion");
  if (report.documentSymbols) capabilities.push("documentSymbols");
  if (report.findUsages) capabilities.push("findUsages");
  return capabilities;
}

export function formatSemanticModeLabel(mode: SemanticMode) {
  if (mode === "semantic") {
    return "ArkTS Semantic";
  }

  if (mode === "fallback") {
    return "Fallback";
  }

  return "Unavailable";
}
