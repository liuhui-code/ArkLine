export type CodeActionKind =
  | "quickfix"
  | "refactor.extract"
  | "refactor.inline"
  | "refactor.rewrite"
  | "source"
  | "generate"
  | "template";

export type CodeActionSafety = "safe" | "needsPreview" | "risky";

export type CodeAction = {
  id: string;
  title: string;
  kind: CodeActionKind;
  provider: "arkts" | "workspace" | "template" | "fallback";
  safety: CodeActionSafety;
  disabledReason?: string;
  editId?: string;
  data?: Record<string, unknown>;
};

export type {
  EditConflict,
  TextRange,
  WorkspaceEditOperation,
  WorkspaceEditPlan,
} from "./workspace-edit-model";

export {
  collectAffectedFiles,
  summarizeWorkspaceEditOperation,
  validateWorkspaceEditPlan,
} from "./workspace-edit-model";

const codeActionKindLabels: Record<CodeActionKind, string> = {
  quickfix: "Quick Fix",
  "refactor.extract": "Refactor: Extract",
  "refactor.inline": "Refactor: Inline",
  "refactor.rewrite": "Refactor: Rewrite",
  source: "Source Action",
  generate: "Generate",
  template: "Template",
};

export function formatCodeActionKind(kind: CodeActionKind) {
  return codeActionKindLabels[kind];
}

export function requiresPreview(action: CodeAction) {
  return action.safety === "needsPreview" || action.safety === "risky";
}
