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
  const activeDocumentRef = useRef({ path: activePath, getContent: getActiveContent });
  const [problems, setProblems] = useState<ProblemItem[]>([]);
  activeDocumentRef.current = { path: activePath, getContent: getActiveContent };

  function commitProblems(items: ProblemItem[]) {
    problemsRef.current.replace(items);
    setProblems([...problemsRef.current.state.items]);
  }

  function resetProblems() {
    commitProblems([]);
  }

  async function refreshProblems(path: string, content: string) {
    const validationProblems = await workspaceApi.runValidation(path, content);
    const activeDocument = activeDocumentRef.current;
    if (activeDocument.path !== path || activeDocument.getContent() !== content) return;
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

  function replaceLiveValidationProblems(path: string, validationProblems: ProblemItem[]) {
    if (path !== activePath) return;
    commitProblems([
      ...problemsRef.current.state.items.filter((item) => item.source === "build"),
      ...validationProblems.filter((item) => item.path === path && item.source !== "build"),
    ]);
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
    replaceLiveValidationProblems,
    replaceBuildProblems,
  };
}
