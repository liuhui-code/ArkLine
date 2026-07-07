import { useRef, useState } from "react";
import { createProblemsStore, type ProblemItem } from "@/features/problems/problems-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";

export type UseProblemsControllerOptions = {
  workspaceApi: WorkspaceApi;
  activePath: string | null;
  getActiveContent: () => string;
  showProblems: () => void;
  onStatusChange: (message: string) => void;
};

export function useProblemsController({
  workspaceApi,
  activePath,
  getActiveContent,
  showProblems,
  onStatusChange,
}: UseProblemsControllerOptions) {
  const problemsRef = useRef(createProblemsStore());
  const [problems, setProblems] = useState<ProblemItem[]>([]);

  function commitProblems(items: ProblemItem[]) {
    problemsRef.current.replace(items);
    setProblems([...problemsRef.current.state.items]);
  }

  function resetProblems() {
    commitProblems([]);
  }

  async function refreshProblems(path: string, content: string) {
    const validationProblems = await workspaceApi.runValidation(path, content);
    commitProblems([
      ...problemsRef.current.state.items.filter((item) => item.source === "build"),
      ...validationProblems,
    ]);
  }

  async function runLint() {
    if (!activePath) return;
    await refreshProblems(activePath, getActiveContent());
    showProblems();
    onStatusChange("Lint complete");
  }

  function replaceBuildProblems(buildProblems: ProblemItem[]) {
    commitProblems([
      ...problemsRef.current.state.items.filter((item) => item.source !== "build"),
      ...buildProblems,
    ]);
  }

  return {
    problems,
    resetProblems,
    refreshProblems,
    runLint,
    replaceBuildProblems,
  };
}
