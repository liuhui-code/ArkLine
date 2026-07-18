import { useEffect, useState } from "react";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import { defaultSemanticState, loadSemanticState } from "@/features/semantic/semantic-store";

export function useSemanticState(workspaceApi: WorkspaceApi) {
  const [semanticState, setSemanticState] = useState(defaultSemanticState);

  async function refreshSemanticState(options: { throwOnError?: boolean } = {}) {
    try {
      setSemanticState(await loadSemanticState(workspaceApi));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSemanticState({
        provider: "error",
        mode: "unavailable",
        detail,
        supervisor: undefined,
      });
      if (options.throwOnError) {
        throw new Error(detail);
      }
    }
  }

  useEffect(() => {
    void refreshSemanticState();
  }, [workspaceApi]);

  return {
    semanticState,
    refreshSemanticState,
  };
}
