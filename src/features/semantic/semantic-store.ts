import type { WorkspaceApi, LanguageServiceReport } from "@/features/workspace/workspace-api";

export type SemanticMode = LanguageServiceReport["mode"];

export type SemanticState = {
  provider: string;
  mode: SemanticMode;
  detail: string;
  supervisor?: LanguageServiceReport["supervisor"];
};

export const defaultSemanticState: SemanticState = {
  provider: "unknown",
  mode: "unavailable",
  detail: "Semantic provider state has not been loaded yet.",
  supervisor: undefined,
};

export async function loadSemanticState(workspaceApi: WorkspaceApi): Promise<SemanticState> {
  if (!workspaceApi.inspectLanguageService) {
    return {
      provider: "unavailable",
      mode: "unavailable",
      detail: "Language service inspection is unavailable in this shell.",
      supervisor: undefined,
    };
  }

  const report = await workspaceApi.inspectLanguageService();
  return {
    provider: report.provider,
    mode: report.mode,
    detail: report.detail,
    supervisor: report.supervisor,
  };
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
