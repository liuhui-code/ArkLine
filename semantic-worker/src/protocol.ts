export interface SemanticDocumentPosition {
  path: string
  line: number
  column: number
  content?: string
}

export type SemanticRequestMethod =
  | "health"
  | "gotoDefinition"
  | "completion"
  | "listCodeActions"
  | "resolveCodeAction"
  | "prepareRename"
  | "rename"

export interface SemanticRequest {
  id: string
  method: SemanticRequestMethod
  position?: SemanticDocumentPosition
  action?: SemanticCodeActionRequest
  newName?: string
}

export interface SemanticCompletionItem {
  label: string
  detail: string
  kind: string
  insertText?: string
  filterText?: string
  sortText?: string
  source?: "workspace" | "arkts" | "arkui" | "sdk" | "fallback"
  documentation?: string
  replacementRange?: SemanticTextRange
  commitCharacters?: string[]
  definitionTarget?: SemanticDefinitionTarget
  data?: Record<string, unknown>
}

export interface SemanticDefinitionTarget {
  path: string
  line: number
  column: number
}

export interface SemanticTextRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

export interface SemanticDefinitionCandidate extends SemanticDefinitionTarget {}

export type SemanticCodeActionKind =
  | "quickfix"
  | "refactor.extract"
  | "refactor.inline"
  | "refactor.rewrite"
  | "source"
  | "generate"
  | "template"

export type SemanticCodeActionSafety = "safe" | "needsPreview" | "risky"

export interface SemanticCodeAction {
  id: string
  title: string
  kind: SemanticCodeActionKind
  provider: "arkts" | "workspace" | "template" | "fallback"
  safety: SemanticCodeActionSafety
  disabledReason?: string
  editId?: string
  data?: Record<string, unknown>
}

export interface SemanticCodeActionRequest {
  id: string
  data?: Record<string, unknown>
}

export interface SemanticCodeActionList {
  actions: SemanticCodeAction[]
}

export interface SemanticEditConflict {
  path: string
  message: string
}

export type SemanticWorkspaceEditOperation =
  | {
      kind: "text"
      path: string
      range: SemanticTextRange
      newText: string
      expectedVersion?: number
    }
  | { kind: "createFile"; path: string; content: string; overwrite: boolean }
  | { kind: "renameFile"; oldPath: string; newPath: string; overwrite: boolean }
  | { kind: "deleteFile"; path: string; recursive: boolean }

export interface SemanticWorkspaceEditPlan {
  id: string
  title: string
  operations: SemanticWorkspaceEditOperation[]
  conflicts: SemanticEditConflict[]
  affectedFiles: string[]
  undoLabel: string
  requiresPreview: boolean
}

export interface SemanticPrepareRenameResult {
  range: SemanticTextRange
  placeholder: string
}

export interface SemanticUnsupportedResult {
  status: "unsupported"
  reason: string
}

export type SemanticResponsePayload =
  | { status: "ready" }
  | SemanticDefinitionTarget
  | { definition: SemanticDefinitionTarget | null; definitionCandidates?: SemanticDefinitionCandidate[] }
  | SemanticCompletionItem[]
  | SemanticCodeActionList
  | SemanticWorkspaceEditPlan
  | SemanticPrepareRenameResult
  | SemanticUnsupportedResult
  | null

export interface SemanticResponse {
  id: string
  ok: boolean
  payload: SemanticResponsePayload
  error?: string
}
