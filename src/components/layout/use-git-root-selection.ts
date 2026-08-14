import { useEffect, useState } from "react";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

export function useGitRootSelection(workspaceRoot: string | null, workspaceApi: WorkspaceApi) {
  const [roots, setRoots] = useState<string[]>([]);
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setRoots([]);
    setSelectedRoot(workspaceRoot);
    if (!workspaceRoot) return () => { active = false; };
    void (workspaceApi.getGitRoots?.(workspaceRoot) ?? Promise.resolve([workspaceRoot])).then((next) => {
      if (!active) return;
      const discovered = next.length ? next : [workspaceRoot];
      setRoots(discovered);
      setSelectedRoot((current) => current && discovered.includes(current) ? current : discovered[0]);
    }).catch(() => active && setRoots([workspaceRoot]));
    return () => { active = false; };
  }, [workspaceApi, workspaceRoot]);
  return { roots, selectedRoot, selectRoot: setSelectedRoot };
}
