import type { WorkspaceEditPlan } from "@/features/code-actions/code-action-model";

export type NavigationLocation = { path: string; line: number; column: number };
export type CompletionSession = { path: string; line: number; replacePrefix: string };
export type CodeActionsStatus = "loading" | "ready" | "empty" | "error";

export type IndexExplainContext = {
  kind: "search" | "definition" | "symbol" | "completion" | "api";
  query: string;
  path?: string;
  line?: number;
  column?: number;
};

export type ProjectMutationDialogState =
  | { kind: "newFile"; parentPath: string; name: string }
  | { kind: "newDirectory"; parentPath: string; name: string };

export function isWorkspaceEditPlan(result: unknown): result is WorkspaceEditPlan {
  return Boolean(result && typeof result === "object" && Array.isArray((result as WorkspaceEditPlan).operations));
}
