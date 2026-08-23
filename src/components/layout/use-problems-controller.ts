import { useRef, useState } from "react";
import { createProblemsStore, type ProblemItem } from "@/features/problems/problems-store";
import type { WorkspaceApi } from "@/features/workspace/workspace-api";
import type { ValidationQueryResult } from "@/features/workspace/workspace-api";

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
    const validation = await workspaceApi.runValidation(path, content);
    const activeDocument = activeDocumentRef.current;
    if (activeDocument.path !== path || activeDocument.getContent() !== content) return null;
    commitProblems([
      ...problemsRef.current.state.items.filter((item) => item.source === "build"),
      ...validation.items,
    ]);
    return validation;
  }

  async function runLint() {
    if (!activePath) return;
    const validation = await refreshProblems(activePath, getActiveContent());
    showProblems();
    if (validation) onStatusChange(validationStatus(validation));
  }

  function replaceLiveValidationProblems(path: string, validation: ValidationQueryResult) {
    if (path !== activePath) return;
    commitProblems([
      ...problemsRef.current.state.items.filter((item) => item.source === "build"),
      ...validation.items.filter((item) => item.path === path && item.source !== "build"),
    ]);
    if (validation.availability !== "ready") {
      onStatusChange(validationStatus(validation));
    }
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

function validationStatus(result: ValidationQueryResult) {
  if (result.availability === "ready") return "Diagnostics complete";
  const detail = result.message ? `: ${result.message}` : "";
  return result.availability === "partial"
    ? `Diagnostics partial${detail}`
    : `Diagnostics unavailable${detail}`;
}
