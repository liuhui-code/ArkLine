import { parseBuildDiagnostics } from "@/features/build/build-diagnostics";
import type { ProblemItem } from "@/features/problems/problems-store";

export function parseBuildProblems(output: string): ProblemItem[] {
  return parseBuildDiagnostics(output);
}
