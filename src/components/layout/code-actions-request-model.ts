import { actionMatchesSource } from "@/components/layout/app-shell-model";
import {
  buildLanguageQueryRequest,
  buildLanguageQuerySnapshot,
  type LanguageQuerySnapshot,
  type LanguageQuerySnapshotInput,
} from "@/components/layout/language-query-request-model";
import type { CodeAction } from "@/features/code-actions/code-action-model";

export type CodeActionsSource = "all" | "rename" | "generate" | "refactor";

export type CodeActionsEditorRequest = {
  path: string;
  line: number;
  column: number;
  content: string;
};

export function buildCodeActionsEditorRequest(input: LanguageQuerySnapshotInput): CodeActionsEditorRequest {
  return buildLanguageQueryRequest(input);
}

export function buildCodeActionsEditorSnapshot(input: LanguageQuerySnapshotInput): LanguageQuerySnapshot {
  return buildLanguageQuerySnapshot(input);
}

export function filterCodeActionsForSource(actions: CodeAction[], source: CodeActionsSource) {
  return actions.filter((action) => actionMatchesSource(action, source));
}

export function codeActionsSourceStatus(source: CodeActionsSource) {
  switch (source) {
    case "rename":
      return "Rename Symbol";
    case "generate":
      return "Generate Code";
    case "refactor":
      return "Refactor This";
    case "all":
      return "Code Actions";
  }
}

export function emptyCodeActionsMessage(source: CodeActionsSource) {
  return `No ${source === "all" ? "code actions" : source} actions available`;
}
