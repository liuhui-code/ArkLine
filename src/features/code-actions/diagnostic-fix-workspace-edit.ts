import type { WorkspaceEditPlan } from "@/features/code-actions/workspace-edit-model";
import type { ValidationFix } from "@/features/workspace/workspace-validation-api-types";

type DiagnosticFixRequest = {
  path: string;
  content: string;
  fix: ValidationFix;
};

export function createDiagnosticFixWorkspaceEditPlan(request: DiagnosticFixRequest): WorkspaceEditPlan {
  const version = contentVersion(request.content);
  const range = {
    startLine: request.fix.startLine,
    startColumn: request.fix.startColumn,
    endLine: request.fix.endLine,
    endColumn: request.fix.endColumn,
  };
  return {
    id: `diagnostic-fix.${contentVersion(`${request.path}:${JSON.stringify(range)}:${request.fix.replacement}`)}`,
    title: request.fix.title,
    operations: [{
      kind: "text",
      path: request.path,
      range,
      newText: request.fix.replacement,
      expectedContentVersion: version,
    }],
    conflicts: [],
    affectedFiles: [request.path],
    undoLabel: `Undo ${request.fix.title}`,
    requiresPreview: true,
  };
}

function contentVersion(content: string) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(content)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
}
